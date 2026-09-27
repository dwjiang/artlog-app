import { ConvexError, type Infer, v } from "convex/values";

import { contributionPayload } from "../shared/attestation/attested-payloads";
import { DESCRIPTOR_BYTES, KEYPOINT_BYTES } from "../shared/orb/features";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { removeContribution } from "./contributionRemoval";
import { requireAttestedWrite } from "./devices";
import { decodeQuery } from "./identify";
import { AGREEMENT_MIN_COSINE, REPLAY_COSINE, contributionGroup } from "./lib/agreement";
import { requireDevice, requireDeviceFromAction } from "./lib/auth";
import { cosine } from "./lib/cosine";
import { fileHash, fileStorage, findFile, reserveFile, retainFile } from "./lib/fileStorage";
import { FIELD_NAMES } from "./lib/labelVerify";
import { withErrorReporting } from "./lib/observability";
import { storeOrb } from "./lib/orbStorage";
import { r2 } from "./lib/r2";
import { limitDevice } from "./lib/rateLimits";
import { recognitionPartition } from "./lib/recognitionEligibility";
import { checkedGroup, groupAnchor, publishContribution, replayArchives } from "./lib/tentativeEntries";
import {
  contributionRejectedReason,
  embeddingArchive,
  type ContributionField,
  type EvidenceKind,
  type LabelFieldName,
  type LabelFlow,
} from "./lib/validators";
import { searchVectorIndex } from "./lib/vectorSearch";
import { readVector } from "./lib/vectorStore";
import { isVenueOptedOut } from "./lib/venueOptOut";
import { getEmbedding, insertEmbedding, requireEmbedding } from "./scanEmbeddings";
import schema from "./schema";

// A vector this close to an indexed work, or to the device's own earlier contribution, is a replay.
export const DUPLICATE_COSINE = 0.982;
// The phone resizes the contribution crop to ≤ 256 px JPEG; anything larger is not a crop.
export const MAX_CROP_BYTES = 200 * 1024;
const CROP_CONTENT_TYPE = "image/jpeg";
const DUPLICATE_PAGE_SIZE = 64;
const DUPLICATE_PAGE_BYTES = 1024 * 1024;
const MAX_COMMIT_ATTEMPTS = 3;

const contributionFields = schema.tables.contributions.validator.fields;
const submittedField = v.object({ value: v.string(), edited: v.boolean() });
const submittedFields = v.object({
  title: submittedField,
  artist: submittedField,
  date: v.optional(submittedField),
  medium: v.optional(submittedField),
  accession: v.optional(submittedField),
  creditLine: v.optional(submittedField),
});
type SubmittedFields = typeof submittedFields.type;
type ContributionFields = Doc<"contributions">["fields"];

const contributionResult = v.object({
  contributionId: v.id("contributions"),
  status: contributionFields.status,
  reason: v.optional(contributionRejectedReason),
});
type ContributionResult = Infer<typeof contributionResult>;

export const requestCropUpload = mutation({
  args: { size: v.number() },
  returns: v.object({ uploadUrl: v.string(), storageId: v.string() }),
  handler: async (ctx, { size }) => {
    const device = await requireDevice(ctx);
    await limitDevice(ctx, "contribute", device._id);
    if (!Number.isInteger(size) || size < 3 || size > MAX_CROP_BYTES) throw new ConvexError({ code: "bad_crop" });
    const storageId = await reserveFile(ctx, CROP_CONTENT_TYPE, size, device._id);
    return { uploadUrl: await r2.uploadUrl(storageId, CROP_CONTENT_TYPE, size), storageId };
  },
});

// Values must be the ones the label flow verified and moderated; the flag can only weaken a field's evidence.
function resolveField(
  flow: LabelFlow,
  name: LabelFieldName,
  input: { value: string; edited: boolean },
): ContributionField {
  const verified = flow.fields[name];
  if (!verified || verified.value !== input.value.trim()) {
    throw new ConvexError({ code: "field_mismatch", field: name });
  }
  return {
    value: verified.value,
    edited: input.edited,
    evidence: input.edited ? "user_edited" : verified.evidence,
  };
}

function resolveFields(flow: LabelFlow, submitted: SubmittedFields): ContributionFields {
  const fields: ContributionFields = {
    title: resolveField(flow, "title", submitted.title),
    artist: resolveField(flow, "artist", submitted.artist),
  };
  for (const name of FIELD_NAMES) {
    const input = submitted[name];
    if (input && name !== "title" && name !== "artist") {
      fields[name] = resolveField(flow, name, input);
    }
  }
  return fields;
}

function evidenceOf(fields: ContributionFields): EvidenceKind[] {
  return [...new Set(FIELD_NAMES.flatMap((name) => (fields[name] ? [fields[name].evidence] : [])))];
}

const duplicatePage = v.object({
  archives: v.array(embeddingArchive),
  cursor: v.union(v.string(), v.null()),
});
type DuplicatePage = Infer<typeof duplicatePage>;
const groupPage = v.object({
  entries: v.array(
    v.object({
      objectId: v.id("objects"),
      anchor: v.union(checkedGroup, v.null()),
      replays: v.array(embeddingArchive),
    }),
  ),
  revision: v.number(),
  cursor: v.union(v.string(), v.null()),
});
type GroupPage = Infer<typeof groupPage>;

export const checkDuplicatePage = internalQuery({
  args: {
    scanId: v.id("scans"),
    generation: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: duplicatePage,
  handler: async (ctx, { scanId, generation, cursor }): Promise<DuplicatePage> => {
    const device = await requireDevice(ctx);
    const scan = await ctx.db.get("scans", scanId);
    if (!scan || scan.deviceId !== device._id || !scan.venueId) {
      throw new ConvexError({ code: "invalid_scan" });
    }
    if (scan.generation !== generation) {
      throw new ConvexError({ code: "scan_restarted" });
    }
    const page = await ctx.db
      .query("contributions")
      .withIndex("by_device_venue_model", (q) =>
        q.eq("deviceId", device._id).eq("venueId", scan.venueId!).eq("modelVersion", scan.modelVersion),
      )
      .paginate({
        cursor,
        numItems: DUPLICATE_PAGE_SIZE,
        maximumBytesRead: DUPLICATE_PAGE_BYTES,
      });
    const archives = [];
    for (const row of page.page) {
      if (row.status === "rejected") continue;
      const previous = await getEmbedding(ctx, row.embeddingId);
      if (previous) archives.push({ archiveId: previous.archiveId, contentHash: previous.contentHash });
    }
    return { archives, cursor: page.isDone ? null : page.continueCursor };
  },
});

async function deleteUnreferencedCrop(ctx: MutationCtx, cropStorageId: string, deviceId: Id<"devices">): Promise<void> {
  const crop = await fileStorage.getMetadata(ctx, cropStorageId);
  if (!crop || crop.uploadOwner !== deviceId || crop.contentType !== CROP_CONTENT_TYPE || crop.size > MAX_CROP_BYTES) {
    return;
  }
  const reference = await ctx.db
    .query("contributions")
    .withIndex("by_cropStorageId", (q) => q.eq("cropStorageId", cropStorageId))
    .first();
  if (!reference) await fileStorage.delete(ctx, cropStorageId);
}

async function validateSubmission(
  ctx: MutationCtx,
  scan: Doc<"scans">,
  submitted: SubmittedFields,
  cropStorageId: string,
  allowPending = false,
): Promise<{ flow: LabelFlow; fields: ContributionFields }> {
  const venue = scan.venueId ? await ctx.db.get("museums", scan.venueId) : null;
  if (!venue || (await isVenueOptedOut(ctx, venue))) {
    throw new ConvexError({ code: "invalid_venue" });
  }
  const flow = scan.labelFlow;
  if (!flow || flow.stage !== "verified" || flow.moderation === "flagged") {
    throw new ConvexError({ code: "label_unverified" });
  }
  const fields = resolveFields(flow, submitted);
  const crop = await findFile(ctx, cropStorageId);
  if (
    !crop
    || (crop.state !== "ready" && !(allowPending && crop.state === "pending"))
    || crop.uploadOwner !== scan.deviceId
    || crop.contentType !== CROP_CONTENT_TYPE
    || crop.size > MAX_CROP_BYTES
  ) {
    throw new ConvexError({ code: "bad_crop" });
  }
  return { flow, fields };
}

const authorizationResult = v.union(
  v.object({ kind: v.literal("existing"), result: contributionResult }),
  v.object({
    kind: v.literal("authorized"),
    scan: schema.doc("scans"),
    archive: embeddingArchive,
    previousContributionId: v.union(v.id("contributions"), v.null()),
  }),
);

export const authorize = internalMutation({
  args: {
    scanId: v.id("scans"),
    fields: submittedFields,
    cropStorageId: v.string(),
    nonce: v.string(),
    assertionBase64: v.string(),
  },
  returns: authorizationResult,
  handler: async (ctx, args): Promise<Infer<typeof authorizationResult>> => {
    const { scanId, cropStorageId } = args;
    const device = await requireAttestedWrite(ctx, {
      ...args,
      payload: contributionPayload({
        scanId,
        cropStorageId,
        fields: args.fields,
      }),
    });
    const scan = await ctx.db.get("scans", scanId);
    if (!scan || scan.deviceId !== device._id || !scan.venueId) {
      throw new ConvexError({ code: "invalid_scan" });
    }
    const existing = await ctx.db
      .query("contributions")
      .withIndex("by_scanId", (q) => q.eq("scanId", scanId))
      .unique();
    if (existing) {
      if (existing.cropStorageId !== cropStorageId) {
        await deleteUnreferencedCrop(ctx, cropStorageId, device._id);
      }
      return {
        kind: "existing",
        result: {
          contributionId: existing._id,
          status: existing.status,
          reason: existing.rejectedReason,
        },
      };
    }
    await validateSubmission(ctx, scan, args.fields, cropStorageId, true);
    // This transaction commits the charge and assertion before any search, including searches that fail.
    await limitDevice(ctx, "contribute", device._id);
    return {
      kind: "authorized",
      scan,
      archive: await requireEmbedding(ctx, scan.embeddingId),
      previousContributionId: device.lastContributionId ?? null,
    };
  },
});

export const findGroupPage = internalQuery({
  args: {
    scanId: v.id("scans"),
    fields: submittedFields,
    cursor: v.union(v.string(), v.null()),
  },
  returns: groupPage,
  handler: async (ctx, { scanId, fields, cursor }): Promise<GroupPage> => {
    const device = await requireDevice(ctx);
    const scan = await ctx.db.get("scans", scanId);
    if (!scan || scan.deviceId !== device._id || !scan.venueId || !scan.labelFlow) {
      throw new ConvexError({ code: "invalid_scan" });
    }
    const venue = await ctx.db.get("museums", scan.venueId);
    const revision = venue?.contributionRevision ?? 0;
    const candidate = {
      venueId: scan.venueId,
      modelVersion: scan.modelVersion,
      fields: resolveFields(scan.labelFlow, fields),
    };
    const page = await ctx.db
      .query("objects")
      .withIndex("by_groupKey", (q) => q.eq("groupKey", contributionGroup(candidate)))
      // Anchor rights checks scan the label group; let the action stop before checking another entry.
      .paginate({ cursor, numItems: 1 });
    const entries = [];
    for (const object of page.page) {
      if (object.reverted || object.mergedInto) continue;
      const anchor = await groupAnchor(ctx, candidate, object);
      entries.push({
        objectId: object._id,
        anchor: anchor
          ? { objectId: object._id, anchorId: anchor._id, ...(await requireEmbedding(ctx, anchor.embeddingId)) }
          : null,
        replays: await replayArchives(ctx, candidate, object),
      });
    }
    return { entries, revision, cursor: page.isDone ? null : page.continueCursor };
  },
});

export const commit = internalMutation({
  args: {
    archiveId: v.string(),
    scanId: v.id("scans"),
    generation: v.number(),
    orbStorageId: v.string(),
    orbSha256: v.string(),
    keypointCount: v.number(),
    fields: submittedFields,
    cropStorageId: v.string(),
    duplicate: v.boolean(),
    previousContributionId: v.union(v.id("contributions"), v.null()),
    group: v.optional(checkedGroup),
    venueRevision: v.number(),
  },
  returns: contributionResult,
  handler: async (ctx, args): Promise<ContributionResult> => {
    const { scanId, cropStorageId } = args;
    const device = await requireDevice(ctx);
    const scan = await ctx.db.get("scans", scanId);
    if (!scan || scan.deviceId !== device._id || !scan.venueId) {
      throw new ConvexError({ code: "invalid_scan" });
    }
    if (scan.generation !== args.generation) {
      throw new ConvexError({ code: "scan_restarted" });
    }
    const existing = await ctx.db
      .query("contributions")
      .withIndex("by_scanId", (q) => q.eq("scanId", scanId))
      .unique();
    if (existing) {
      if (existing.cropStorageId !== cropStorageId) {
        await deleteUnreferencedCrop(ctx, cropStorageId, device._id);
      }
      return {
        contributionId: existing._id,
        status: existing.status,
        reason: existing.rejectedReason,
      };
    }
    // Paginated queries span transactions; repeat the check if another submission committed meanwhile.
    if ((device.lastContributionId ?? null) !== args.previousContributionId) {
      throw new ConvexError({ code: "contributions_changed" });
    }
    const { flow, fields } = await validateSubmission(ctx, scan, args.fields, cropStorageId);
    const orb = await fileStorage.getMetadata(ctx, args.orbStorageId);
    if (!orb || orb.size !== args.keypointCount * (DESCRIPTOR_BYTES + KEYPOINT_BYTES)) {
      throw new ConvexError({ code: "bad_orb_file" });
    }
    const venue = (await ctx.db.get("museums", scan.venueId))!;
    if ((venue.contributionRevision ?? 0) !== args.venueRevision) {
      throw new ConvexError({ code: "contributions_changed" });
    }
    const own = args.group?.objectId
      ? await ctx.db
          .query("contributions")
          .withIndex("by_object_device", (q) =>
            q.eq("indexedObjectId", args.group?.objectId).eq("deviceId", device._id).eq("status", "tentative"),
          )
          .first()
      : null;
    const duplicate = args.duplicate || own !== null;
    const cropOwner = await ctx.db
      .query("contributions")
      .withIndex("by_cropStorageId", (q) => q.eq("cropStorageId", cropStorageId))
      .first();
    if (!duplicate && cropOwner) {
      throw new ConvexError({ code: "crop_already_shared" });
    }
    if (duplicate) await deleteUnreferencedCrop(ctx, cropStorageId, device._id);
    const archive = await requireEmbedding(ctx, scan.embeddingId);
    if (archive.archiveId !== args.archiveId) throw new ConvexError({ code: "scan_restarted" });
    const contributionId = await ctx.db.insert("contributions", {
      deviceId: device._id,
      venueId: scan.venueId,
      scanId,
      embeddingId: await insertEmbedding(ctx, archive),
      modelVersion: scan.modelVersion,
      orbStorageId: duplicate ? undefined : args.orbStorageId,
      orbSha256: duplicate ? undefined : args.orbSha256,
      keypointCount: args.keypointCount,
      cropStorageId: duplicate ? undefined : cropStorageId,
      rawOcr: flow.rawOcr,
      fields,
      evidence: evidenceOf(fields),
      sourceUrl: flow.sourceUrl,
      // A Wikidata match identifies the title/artist pair; an edit to either breaks that binding.
      wikidataId: fields.title.edited || fields.artist.edited ? undefined : flow.wikidataId,
      status: duplicate ? "rejected" : "tentative",
      rejectedReason: duplicate ? "duplicate" : undefined,
      createdAt: Date.now(),
    });
    if (!duplicate) {
      await retainFile(ctx, cropStorageId, true);
      await retainFile(ctx, args.orbStorageId);
      await publishContribution(ctx, (await ctx.db.get("contributions", contributionId))!, args.group);
    }
    await ctx.db.patch("museums", venue._id, {
      contributionRevision: (venue.contributionRevision ?? 0) + 1,
    });
    await ctx.db.patch("devices", device._id, { lastContributionId: contributionId });
    return duplicate
      ? { contributionId, status: "rejected", reason: "duplicate" }
      : { contributionId, status: "tentative" };
  },
});

export const contribute = action({
  args: {
    scanId: v.id("scans"),
    descriptors: v.bytes(),
    keypoints: v.bytes(),
    fields: submittedFields,
    cropStorageId: v.string(),
    nonce: v.string(),
    assertionBase64: v.string(),
  },
  returns: contributionResult,
  handler: async (ctx, args): Promise<ContributionResult> =>
    withErrorReporting("contributions.contribute", async () => {
      const keypointCount = decodeQuery(args.descriptors, args.keypoints).count;
      const { nonce, assertionBase64, descriptors, keypoints, ...submission } = args;
      const authorization = await ctx.runMutation(internal.contributions.authorize, {
        scanId: args.scanId,
        cropStorageId: args.cropStorageId,
        fields: args.fields,
        nonce,
        assertionBase64,
      });
      if (authorization.kind === "existing") return authorization.result;
      const device = await requireDeviceFromAction(ctx);
      const crop = await ctx.runQuery(internal.files.metadata, { id: args.cropStorageId });
      if (!crop || crop.uploadOwner !== device._id || crop.state === "deleting") {
        throw new ConvexError({ code: "bad_crop" });
      }
      if (crop.state === "pending") {
        const blob = await r2.get(crop._id);
        const header = blob ? new Uint8Array(await blob.slice(0, 3).arrayBuffer()) : null;
        if (
          !blob
          || blob.size !== crop.size
          || blob.size > MAX_CROP_BYTES
          || blob.type !== CROP_CONTENT_TYPE
          || header?.[0] !== 0xff
          || header[1] !== 0xd8
          || header[2] !== 0xff
        ) {
          throw new ConvexError({ code: "bad_crop" });
        }
        const sha256 = await fileHash(blob);
        await ctx.runMutation(internal.files.complete, { id: args.cropStorageId, sha256 });
      }
      const { scan, archive } = authorization;
      const vector = await readVector(ctx, archive);
      let { previousContributionId } = authorization;
      const matches = await searchVectorIndex(ctx, vector, recognitionPartition(scan.modelVersion), 3);
      const established = await ctx.runQuery(internal.identify.loadCandidates, {
        recordIds: matches.map((match) => match.id),
        scores: matches.map((match) => match.score),
        venueId: scan.venueId,
        now: Date.now(),
      });
      const orb = await storeOrb(ctx, descriptors, keypoints);
      try {
        for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
          let duplicate = established.some(
            (candidate) =>
              candidate.object.identityStatus === "established" && candidate.similarity >= DUPLICATE_COSINE,
          );
          let cursor: string | null = null;
          do {
            if (duplicate) break;
            const page: DuplicatePage = await ctx.runQuery(internal.contributions.checkDuplicatePage, {
              scanId: scan._id,
              generation: scan.generation,
              cursor,
            });
            for (const reference of page.archives) {
              if (cosine(vector, await readVector(ctx, reference)) >= DUPLICATE_COSINE) {
                duplicate = true;
                break;
              }
            }
            cursor = page.cursor;
          } while (cursor !== null);
          try {
            let group: Infer<typeof checkedGroup> | undefined;
            let venueRevision: number | undefined;
            let groupCursor: string | null = null;
            do {
              const page: GroupPage = await ctx.runQuery(internal.contributions.findGroupPage, {
                scanId: scan._id,
                fields: args.fields,
                cursor: groupCursor,
              });
              if (venueRevision !== undefined && venueRevision !== page.revision) {
                throw new ConvexError({ code: "contributions_changed" });
              }
              venueRevision = page.revision;
              for (const entry of page.entries) {
                for (const reference of entry.replays) {
                  if (cosine(vector, await readVector(ctx, reference)) >= REPLAY_COSINE) {
                    duplicate = true;
                    break;
                  }
                }
                if (duplicate) break;
                if (entry.anchor) {
                  const similarity = cosine(vector, await readVector(ctx, entry.anchor));
                  if (similarity >= AGREEMENT_MIN_COSINE && similarity < REPLAY_COSINE) {
                    group = entry.anchor;
                    break;
                  }
                }
              }
              groupCursor = duplicate || group ? null : page.cursor;
            } while (groupCursor !== null);
            return await ctx.runMutation(internal.contributions.commit, {
              ...submission,
              archiveId: archive.archiveId,
              generation: scan.generation,
              keypointCount,
              duplicate,
              previousContributionId,
              group,
              venueRevision: venueRevision!,
              orbStorageId: orb.storageId,
              orbSha256: orb.sha256,
            });
          } catch (error) {
            if (!(error instanceof ConvexError) || error.data.code !== "contributions_changed") {
              throw error;
            }
            previousContributionId = (await requireDeviceFromAction(ctx)).lastContributionId ?? null;
          }
        }
        throw new ConvexError({ code: "contribution_busy" });
      } finally {
        await ctx.runMutation(internal.orbFiles.discard, {
          storageIds: [orb.storageId],
        });
      }
    }),
});

export const withdraw = mutation({
  args: { contributionId: v.id("contributions") },
  returns: v.null(),
  handler: async (ctx, { contributionId }) => {
    const device = await requireDevice(ctx);
    const row = await ctx.db.get("contributions", contributionId);
    if (!row || row.deviceId !== device._id) {
      throw new ConvexError({ code: "contribution_not_found" });
    }
    await removeContribution(ctx, row, "withdrawn");
    return null;
  },
});
