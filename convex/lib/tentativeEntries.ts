import { ConvexError, v, type Infer } from "convex/values";

import model from "../../shared/model/model-version.json";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { bumpCounter } from "../ingest";
import { getEmbedding, requireEmbedding } from "../scanEmbeddings";
import { contributionGroup, verifiedAccession } from "./agreement";
import { readContributionState, patchContributionState } from "./objectContributionState";
import { newObjectCounters } from "./objectCounters";
import { patchObjectDetails, readObjectOrb } from "./objectDetails";
import { findPlacement } from "./placements";
import {
  contributionRightsIssue,
  eligibleContribution,
  eligibleObjectRecord,
  recognitionPartition,
} from "./recognitionEligibility";
import { embeddingArchive, type EmbeddingArchive } from "./validators";
import { insertArchivedVector } from "./vectorStore";

const ANCHOR_PAGE = 25;
const REPLAY_CHECK_VECTORS = 32;

export function earlier(a: Doc<"contributions">, b: Doc<"contributions"> | null): boolean {
  return !b || a._creationTime < b._creationTime || (a._creationTime === b._creationTime && a._id < b._id);
}

// The displayed reference can be withdrawn or banned before its rebuild runs. The oldest surviving
// backer anchors the group meanwhile, so a concurrent submission joins the entry instead of forking it.
async function eligibleAnchor(ctx: QueryCtx, object: Doc<"objects">): Promise<Doc<"contributions"> | null> {
  const source = object.sourceContributionId ? await ctx.db.get("contributions", object.sourceContributionId) : null;
  if (await eligibleContribution(ctx, source)) return source;
  const rows = await ctx.db
    .query("contributions")
    .withIndex("by_object_status", (q) => q.eq("indexedObjectId", object._id).eq("status", "tentative"))
    .take(ANCHOR_PAGE);
  for (const row of rows) if (await eligibleContribution(ctx, row)) return row;
  return null;
}

// A vector already on the entry this close to the submission is the same photo, not a second view.
export async function replayArchives(
  ctx: QueryCtx,
  row: Pick<Doc<"contributions">, "modelVersion">,
  object: Doc<"objects">,
): Promise<EmbeddingArchive[]> {
  const vectors = await ctx.db
    .query("vectors")
    .withIndex("by_objectId_modelVersion_source", (q) =>
      q.eq("objectId", object._id).eq("modelVersion", row.modelVersion).eq("source", "user"),
    )
    .take(REPLAY_CHECK_VECTORS);
  const archives: EmbeddingArchive[] = [];
  for (const vector of vectors) {
    const source = vector.contributionId ? await ctx.db.get("contributions", vector.contributionId) : null;
    const evidence = source ? await getEmbedding(ctx, source.embeddingId) : null;
    if (evidence) archives.push({ archiveId: evidence.archiveId, contentHash: evidence.contentHash });
  }
  return archives;
}

// The eligible backer a compatible submission is measured against, or null when the entry is not its group.
export async function groupAnchor(
  ctx: QueryCtx,
  row: Pick<Doc<"contributions">, "venueId" | "modelVersion" | "fields">,
  object: Doc<"objects">,
): Promise<Doc<"contributions"> | null> {
  if (
    object.identityStatus !== "tentative"
    || object.ownerId !== row.venueId
    || (await readContributionState(ctx, object._id))?.groupKey !== contributionGroup(row)
    || !(await eligibleObjectRecord(ctx, object))
  ) {
    return null;
  }
  const anchor = await eligibleAnchor(ctx, object);
  if (!anchor || anchor.modelVersion !== row.modelVersion) return null;
  const accession = verifiedAccession(row);
  if (accession && object.provenance?.verifiedAccession && accession !== object.provenance.verifiedAccession) {
    return null;
  }
  return (await getEmbedding(ctx, anchor.embeddingId)) ? anchor : null;
}

export async function applyReference(
  ctx: MutationCtx,
  object: Doc<"objects">,
  source: Doc<"contributions">,
  accession?: string,
): Promise<void> {
  if (
    !source.orbStorageId
    || !source.orbSha256
    || !source.cropStorageId
    || !(await eligibleContribution(ctx, source))
  ) {
    throw new ConvexError({ code: "reference_descriptors_required" });
  }
  await ctx.db.patch("artworks", object.artworkId, {
    title: source.fields.title.value,
    artist: source.fields.artist.value,
    date: source.fields.date?.value,
    retiredAt: undefined,
  });
  await ctx.db.patch("objects", object._id, {
    sourceContributionId: source._id,
    sourceId: source._id,
    accession: source.fields.accession?.value,
    // Claims remain on contributions, including URLs and Wikidata IDs.
    provenance: {
      contributionIds: [],
      deviceIds: [],
      verifiedAccession: accession,
    },
  });
  await patchObjectDetails(ctx, object, {
    thumbnailStorageId: source.cropStorageId,
    imageRef: `storage:${source.cropStorageId}`,
    medium: source.fields.medium?.value,
  });
  const scan = source.scanId ? await ctx.db.get("scans", source.scanId) : null;
  const placement = await findPlacement(ctx, object._id, source.venueId, "contribution");
  if (placement) await ctx.db.patch("placements", placement._id, { gallery: scan?.gallery });
  const reference = await readObjectOrb(ctx, object);
  const fields = {
    contributionId: source._id,
    storageId: source.orbStorageId,
    sha256: source.orbSha256,
    keypointCount: source.keypointCount,
    inputSize: model.inputSize,
    extractedFrom: `contribution:${source._id}`,
  };
  await patchObjectDetails(ctx, object, { orb: fields });
  if (!reference) await bumpCounter(ctx, "descriptors", 1);
}

export const checkedGroup = v.object({
  objectId: v.id("objects"),
  anchorId: v.id("contributions"),
  ...embeddingArchive.fields,
});

export async function publishContribution(
  ctx: MutationCtx,
  row: Doc<"contributions">,
  group?: Infer<typeof checkedGroup>,
): Promise<Id<"objects">> {
  const issue = await contributionRightsIssue(ctx, row);
  if (issue) throw new ConvexError({ code: issue });
  let object = group ? await ctx.db.get("objects", group.objectId) : null;
  const archive = await requireEmbedding(ctx, row.embeddingId);
  const anchor = object ? await groupAnchor(ctx, row, object) : null;
  const anchorArchive = anchor ? await requireEmbedding(ctx, anchor.embeddingId) : null;
  if (
    group
    && (!anchor
      || anchor._id !== group.anchorId
      || anchorArchive?.archiveId !== group.archiveId
      || anchorArchive.contentHash !== group.contentHash)
  ) {
    throw new ConvexError({ code: "contributions_changed" });
  }
  if (object) {
    const own = await ctx.db
      .query("contributions")
      .withIndex("by_object_device", (q) =>
        q.eq("indexedObjectId", object!._id).eq("deviceId", row.deviceId).eq("status", "tentative"),
      )
      .first();
    if (own) throw new ConvexError({ code: "duplicate_entry" });
  } else {
    const artworkId = await ctx.db.insert("artworks", {
      key: `community:${row._id}`,
      identityStatus: "tentative",
      title: row.fields.title.value,
      artist: row.fields.artist.value,
      date: row.fields.date?.value,
      rightsStatus: "unknown",
      multiplicity: "unknown",
      enrichGeneration: 0,
    });
    const objectId = await ctx.db.insert("objects", {
      key: `user:${row._id}`,
      identityStatus: "tentative",
      artworkId,
      ownerId: row.venueId,
      source: "user",
      sourceId: row._id,
      ...newObjectCounters,
      reverted: false,
    });
    await patchContributionState(ctx, objectId, { groupKey: contributionGroup(row) });
    object = (await ctx.db.get("objects", objectId))!;
    const scan = row.scanId ? await ctx.db.get("scans", row.scanId) : null;
    await ctx.db.insert("placements", {
      identityStatus: "tentative",
      objectId,
      venueId: row.venueId,
      gallery: scan?.gallery,
      onView: true,
      source: "contribution",
      confidence: 0.7,
    });
    await bumpCounter(ctx, "artworks", 1);
    await bumpCounter(ctx, "objects", 1);
    await bumpCounter(ctx, "placements", 1);
  }
  await ctx.db.patch("contributions", row._id, { indexedObjectId: object._id });
  await insertArchivedVector(ctx, {
    objectId: object._id,
    modelVersion: row.modelVersion,
    source: "user",
    partition: recognitionPartition(row.modelVersion, row.venueId),
    contributionId: row._id,
    ...archive,
  });
  await bumpCounter(ctx, "vectors", 1);
  await ctx.scheduler.runAfter(0, internal.vectorSync.drain, {});
  const source = anchor && earlier(anchor, row) ? anchor : row;
  await applyReference(ctx, object, source, object.provenance?.verifiedAccession ?? verifiedAccession(row));
  await ctx.db.patch("objects", object._id, {
    supportRevision: object.supportRevision + 1,
  });
  return object._id;
}
