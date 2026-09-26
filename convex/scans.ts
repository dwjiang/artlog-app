import { ConvexError, type Infer, v } from "convex/values";

import { sameOwner } from "../shared/journal/contracts";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { docentStatusOf } from "./docent";
import { readArtworkContent } from "./lib/artworkContent";
import { requireDevice } from "./lib/auth";
import { fileStorage } from "./lib/fileStorage";
import { displayLabelFlow } from "./lib/labelVerify";
import { isSupported } from "./lib/modelVersion";
import { readObjectDetails } from "./lib/objectDetails";
import { withErrorReporting } from "./lib/observability";
import { ownerForDevice, requireJournalOwner } from "./lib/ownership";
import { eligibleObject } from "./lib/recognitionEligibility";
import {
  embedding,
  embeddingArchive,
  docentSentence,
  docentStatus,
  factChip,
  labelFlowDisplay,
  rightsStatus,
  snapshotFields,
} from "./lib/validators";
import { vectorHash, withVectorArchives } from "./lib/vectorStore";
import { deleteEmbedding, insertExpiringEmbedding, getEmbedding } from "./scanEmbeddings";
import schema from "./schema";

const scanFields = schema.tables.scans.validator.fields;
export const displayCandidate = snapshotFields.extend({
  objectId: v.id("objects"),
  artworkId: v.id("artworks"),
  probability: v.number(),
  identityStatus: schema.tables.objects.validator.fields.identityStatus,
  rightsStatus,
  thumbnailUrl: v.optional(v.string()),
  gallery: v.optional(v.string()),
});

export const scanDisplay = v.object({
  scanId: v.id("scans"),
  localId: v.string(),
  venueId: scanFields.venueId,
  visitId: scanFields.visitId,
  capturedAt: v.number(),
  status: scanFields.status,
  outcome: scanFields.outcome,
  calibratorVersion: scanFields.calibratorVersion,
  best: v.optional(displayCandidate),
  runnerUps: v.optional(v.array(displayCandidate)),
  // Docent prose and its source chips come from the artwork; only a confident card shows them.
  docent: v.optional(v.array(docentSentence)),
  docentStatus: v.optional(docentStatus),
  factSheet: v.optional(v.array(factChip)),
  rightNow: scanFields.rightNow,
  // The label flow is the owner's own state; the raw OCR reading stays server-side.
  labelFlow: v.optional(labelFlowDisplay),
  error: scanFields.error,
});
export type ScanDisplay = Infer<typeof scanDisplay>;

const createArgs = {
  scope: v.optional(v.string()),
  deviceId: v.id("devices"),
  localId: v.string(),
  venueId: scanFields.venueId,
  visitId: scanFields.visitId,
  gallery: scanFields.gallery,
  modelVersion: v.string(),

  capturedAt: v.number(),
};
const created = v.object({ scan: schema.doc("scans"), existing: v.boolean() });

async function prepareScan(ctx: QueryCtx, args: Infer<typeof vCreateArgs>) {
  const device = await ctx.db.get("devices", args.deviceId);
  if (!device || device.banned) throw new ConvexError({ code: "not_found" });
  if (args.scope !== undefined) await requireJournalOwner(ctx, args.scope);
  const owner = await ownerForDevice(ctx, device);
  const existing = await ctx.db
    .query("scans")
    .withIndex("by_device_localId", (q) => q.eq("deviceId", args.deviceId).eq("localId", args.localId))
    .unique();
  const restart =
    existing
    && existing.status !== "identified"
    && isSupported(args.modelVersion)
    && (existing.status === "unsupported_version"
      || existing.status === "failed"
      || existing.modelVersion !== args.modelVersion
      || (await getEmbedding(ctx, existing.embeddingId)) === null);
  const visit = args.visitId ? await ctx.db.get("visits", args.visitId) : null;
  if (args.visitId && (!visit || !sameOwner(visit.owner, owner))) {
    throw new ConvexError({ code: "not_found" });
  }
  // New captures follow a moved visit; retries keep the context already used for this scan's recognition.
  const venueId = existing ? existing.venueId : (visit?.venueId ?? args.venueId);
  if (venueId && !(await ctx.db.get("museums", venueId))) {
    throw new ConvexError({ code: "invalid_venue" });
  }
  if (
    existing
    && (existing.visitId !== args.visitId
      || (!visit && existing.venueId !== args.venueId)
      || existing.capturedAt !== args.capturedAt)
  ) {
    throw new ConvexError({ code: "not_found" });
  }
  return { existing, restart: !!restart, venueId };
}
const vCreateArgs = v.object(createArgs);

export const prepare = internalQuery({
  args: createArgs,
  returns: v.object({
    existing: v.union(schema.doc("scans"), v.null()),
    restart: v.boolean(),
    venueId: scanFields.venueId,
  }),
  handler: prepareScan,
});

export const commit = internalMutation({
  args: { ...createArgs, archive: v.optional(embeddingArchive) },
  returns: created,
  handler: async (ctx, { archive, ...args }) => {
    const { existing, restart, venueId } = await prepareScan(ctx, args);
    if (existing && !restart) return { scan: existing, existing: true };
    if (isSupported(args.modelVersion) && !archive) throw new ConvexError({ code: "vector_archive_missing" });
    const now = Date.now();
    const { scope: _scope, ...scanArgs } = args;
    if (existing) await deleteEmbedding(ctx, existing.embeddingId);
    const embeddingId = archive ? await insertExpiringEmbedding(ctx, archive) : undefined;
    const fields = {
      ...scanArgs,
      venueId,
      embeddingId,
      generation: existing ? existing.generation + 1 : 0,
      status: "pending" as const,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const scanId = existing?._id ?? (await ctx.db.insert("scans", fields));
    if (existing) await ctx.db.replace("scans", scanId, fields);
    return { scan: (await ctx.db.get("scans", scanId))!, existing: false };
  },
});

export const create = internalAction({
  args: { ...createArgs, vector: embedding },
  returns: created,
  handler: async (ctx, { vector, ...args }): Promise<Infer<typeof created>> =>
    withErrorReporting("scans.create", async () => {
      const { existing, restart } = await ctx.runQuery(internal.scans.prepare, args);
      if (existing && !restart) return { scan: existing, existing: true };
      if (!isSupported(args.modelVersion)) return ctx.runMutation(internal.scans.commit, args);
      const contentHash = await vectorHash(vector);
      return withVectorArchives(ctx, [{ vector }], ([archiveId]) =>
        ctx.runMutation(internal.scans.commit, {
          ...args,
          archive: { archiveId, contentHash },
        }),
      );
    }),
});

export const setResult = internalMutation({
  args: {
    scanId: v.id("scans"),
    generation: v.number(),
    status: scanFields.status,
    outcome: scanFields.outcome,
    best: scanFields.best,
    runnerUps: scanFields.runnerUps,
    candidateSignals: scanFields.candidateSignals,
    calibratorVersion: v.string(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const scan = await ctx.db.get("scans", args.scanId);
    if (!scan) throw new ConvexError({ code: "scan_not_found" });
    if (scan.generation !== args.generation || scan.status !== "pending") {
      return null;
    }
    const device = await ctx.db.get("devices", scan.deviceId);
    if (!device || device.banned) return null;
    const valid = async (match: NonNullable<typeof args.best>) => {
      const object = await ctx.db.get("objects", match.objectId);
      return (
        !!object && object.identityStatus === match.identityStatus && (await eligibleObject(ctx, object, scan.venueId))
      );
    };
    const best = args.best && (await valid(args.best)) ? args.best : undefined;
    const runnerUps = [];
    for (const candidate of args.runnerUps ?? []) {
      if (await valid(candidate)) runnerUps.push(candidate);
    }
    const outcome = !best
      ? "miss"
      : best.identityStatus === "tentative" && args.outcome === "confident"
        ? "soft"
        : args.outcome;
    await ctx.db.patch("scans", scan._id, {
      status: args.status,
      outcome,
      best,
      runnerUps,
      candidateSignals: args.candidateSignals,
      calibratorVersion: args.calibratorVersion,
      error: args.error,
      updatedAt: Date.now(),
    });
    if (outcome === "confident" && scan.visitId && args.best?.gallery !== undefined) {
      const visit = await ctx.db.get("visits", scan.visitId);
      const device = await ctx.db.get("devices", scan.deviceId);
      if (
        visit
        && device
        && sameOwner(visit.owner, await ownerForDevice(ctx, device))
        && visit.venueId === scan.venueId
        && (visit.lastConfidentAt === undefined || scan.capturedAt >= visit.lastConfidentAt)
      ) {
        await ctx.db.patch("visits", visit._id, {
          lastConfidentGallery: args.best.gallery,
          lastConfidentAt: scan.capturedAt,
        });
      }
    }
    return null;
  },
});

export async function joinCandidate(
  ctx: QueryCtx,
  match: NonNullable<Doc<"scans">["best"]>,
  venueId?: Doc<"scans">["venueId"],
): Promise<{
  candidate: Infer<typeof displayCandidate>;
  artwork: Doc<"artworks">;
} | null> {
  const [object, artwork] = await Promise.all([
    ctx.db.get("objects", match.objectId),
    ctx.db.get("artworks", match.artworkId),
  ]);
  if (!object || !artwork || !(await eligibleObject(ctx, object, venueId))) {
    return null;
  }
  const details = await readObjectDetails(ctx, object);
  const owner = object.ownerId ? await ctx.db.get("museums", object.ownerId) : null;
  // A hotlinked source image only for public-domain works; a contributor's consented crop always.
  const thumbnailUrl = details?.thumbnailStorageId
    ? await fileStorage.getUrl(ctx, details.thumbnailStorageId)
    : artwork.rightsStatus === "public_domain"
      ? details?.thumbnailUrl
      : undefined;
  // The verifier's projected corners stay on the scan as evidence; the card no longer draws them.
  const { corners, ...fields } = match;
  return {
    artwork,
    candidate: {
      ...fields,
      title: artwork.title,
      artist: artwork.artist,
      date: artwork.date,
      medium: details?.medium,
      institution: owner?.name,
      rightsStatus: artwork.rightsStatus,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    },
  };
}

async function displayScan(ctx: QueryCtx, scan: Doc<"scans">): Promise<ScanDisplay> {
  const [best, runnerUps] = await Promise.all([
    scan.best ? joinCandidate(ctx, scan.best, scan.venueId) : null,
    Promise.all((scan.runnerUps ?? []).map((match) => joinCandidate(ctx, match, scan.venueId))),
  ]);
  const prose =
    scan.outcome === "confident" && best?.candidate.identityStatus === "established" ? best?.artwork : undefined;
  const content = prose ? await readArtworkContent(ctx, prose) : null;
  return {
    scanId: scan._id,
    localId: scan.localId,
    venueId: scan.venueId,
    visitId: scan.visitId,
    capturedAt: scan.capturedAt,
    status: scan.status,
    outcome: scan.outcome,
    calibratorVersion: scan.calibratorVersion,
    best: best?.candidate,
    runnerUps: runnerUps.flatMap((joined) => (joined ? [joined.candidate] : [])),
    docent: content?.docent?.en,
    docentStatus: prose && docentStatusOf(prose, content),
    factSheet: content?.factSheet?.map(({ id, sourceUrl, sourceLabel }) => ({
      id,
      sourceUrl,
      sourceLabel,
    })),
    rightNow: scan.rightNow,
    labelFlow: scan.labelFlow && displayLabelFlow(scan.labelFlow),
    error: scan.error,
  };
}

export const get = query({
  args: { scanId: v.id("scans") },
  returns: v.union(scanDisplay, v.null()),
  handler: async (ctx, { scanId }) => {
    const device = await requireDevice(ctx);
    const scan = await ctx.db.get("scans", scanId);
    return scan?.deviceId === device._id ? displayScan(ctx, scan) : null;
  },
});

export const getStored = internalQuery({
  args: { scanId: v.id("scans") },
  returns: v.union(schema.doc("scans"), v.null()),
  handler: (ctx, { scanId }) => ctx.db.get("scans", scanId),
});

export const getDisplay = internalQuery({
  args: { scanId: v.id("scans"), deviceId: v.id("devices") },
  returns: scanDisplay,
  handler: async (ctx, { scanId, deviceId }) => {
    const scan = await ctx.db.get("scans", scanId);
    if (!scan || scan.deviceId !== deviceId) {
      throw new ConvexError({ code: "scan_not_found" });
    }
    return displayScan(ctx, scan);
  },
});
