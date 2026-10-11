import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { bumpCounter } from "./ingest";
import { cosine } from "./lib/cosine";
import { isSupported } from "./lib/modelVersion";
import { withErrorReporting } from "./lib/observability";
import {
  eligibleLinkedScan,
  eligibleObjectRecord,
  isLinkedView,
  recognitionPartition,
} from "./lib/recognitionEligibility";
import { deleteVector, insertArchivedVector, readVector } from "./lib/vectorStore";
import { MULTI_VIEW_DUPLICATE_COSINE } from "./promotion";
import { getEmbedding } from "./scanEmbeddings";
import schema from "./schema";

// No ORB check backs a link, so its photo must already look like the work before it can teach recognition.
export const LINKED_VIEW_MIN_COSINE = 0.62;
const REFERENCE_LIMIT = 16;
// A work with this many visitor views needs no more, which also bounds the duplicate check.
export const MAX_VISITOR_VIEWS = 64;

const pendingView = v.object({
  objectId: v.id("objects"),
  modelVersion: v.string(),
  archive: v.object({ archiveId: v.id("files"), contentHash: v.string() }),
  references: v.array(schema.doc("vectors")),
  views: v.array(schema.doc("vectors")),
});

// A scan saved under the catalogue work its verified label linked: its photo becomes one more view of that work,
// so the next visitor's photo in the same light can match.
async function pendingLinkedView(ctx: QueryCtx, scanId: Id<"scans">) {
  const scan = await ctx.db.get("scans", scanId);
  if (!scan?.linked || scan.linked.source !== "label" || !isSupported(scan.modelVersion)) return null;
  const { objectId } = scan.linked;
  const device = await ctx.db.get("devices", scan.deviceId);
  const object = await ctx.db.get("objects", objectId);
  const embedding = await getEmbedding(ctx, scan.embeddingId);
  if (
    !device
    || device.banned
    || !embedding
    || !(await eligibleLinkedScan(ctx, scan))
    || object?.identityStatus !== "established"
    || !(await eligibleObjectRecord(ctx, object))
  ) {
    return null;
  }
  const scanVectors = await ctx.db
    .query("vectors")
    .withIndex("by_scanId", (q) => q.eq("scanId", scanId))
    .collect();
  if (scanVectors.some(isLinkedView)) return null;
  const bySource = (source: Doc<"vectors">["source"], limit: number) =>
    ctx.db
      .query("vectors")
      .withIndex("by_objectId_modelVersion_source", (q) =>
        q.eq("objectId", objectId).eq("modelVersion", scan.modelVersion).eq("source", source),
      )
      .take(limit);
  const references = await bySource("corpus", REFERENCE_LIMIT);
  const views = await bySource("user_scan", MAX_VISITOR_VIEWS);
  if (references.length === 0 || views.length === MAX_VISITOR_VIEWS) return null;
  return {
    objectId,
    modelVersion: scan.modelVersion,
    archive: { archiveId: embedding.archiveId, contentHash: embedding.contentHash },
    references,
    views,
  };
}

export const prepare = internalQuery({
  args: { scanId: v.id("scans") },
  returns: v.union(pendingView, v.null()),
  handler: (ctx, { scanId }) => pendingLinkedView(ctx, scanId),
});

export const learn = internalAction({
  args: { scanId: v.id("scans") },
  returns: v.null(),
  handler: (ctx, { scanId }) =>
    withErrorReporting("linkedViews.learn", async () => {
      const view = await ctx.runQuery(internal.linkedViews.prepare, { scanId });
      if (!view) return null;
      const photo = await readVector(ctx, view.archive);
      let reference = 0;
      for (const row of view.references) reference = Math.max(reference, cosine(await readVector(ctx, row), photo));
      if (reference < LINKED_VIEW_MIN_COSINE) return null;
      for (const row of view.views) {
        if (cosine(await readVector(ctx, row), photo) >= MULTI_VIEW_DUPLICATE_COSINE) return null;
      }
      await ctx.runMutation(internal.linkedViews.commit, {
        scanId,
        objectId: view.objectId,
        checked: view.views.map((row) => row._id),
      });
      return null;
    }),
});

export const commit = internalMutation({
  args: { scanId: v.id("scans"), objectId: v.id("objects"), checked: v.array(v.id("vectors")) },
  returns: v.null(),
  handler: async (ctx, { scanId, objectId, checked }) => {
    const view = await pendingLinkedView(ctx, scanId);
    if (!view || view.objectId !== objectId) return null;
    // A view added while the archives were read was not compared with this photo.
    if (view.views.length !== checked.length || view.views.some((row, index) => row._id !== checked[index])) {
      await ctx.scheduler.runAfter(0, internal.linkedViews.learn, { scanId });
      return null;
    }
    await insertArchivedVector(ctx, {
      objectId,
      modelVersion: view.modelVersion,
      source: "user_scan",
      partition: recognitionPartition(view.modelVersion),
      scanId,
      ...view.archive,
    });
    await bumpCounter(ctx, "vectors", 1);
    return null;
  },
});

/** Withdraws the recognition view a scan lent its linked work. */
export async function dropLinkedView(ctx: MutationCtx, scanId: Id<"scans">): Promise<void> {
  const scanVectors = await ctx.db
    .query("vectors")
    .withIndex("by_scanId", (q) => q.eq("scanId", scanId))
    .collect();
  for (const vector of scanVectors.filter(isLinkedView)) {
    await deleteVector(ctx, vector);
    await bumpCounter(ctx, "vectors", -1);
    await ctx.scheduler.runAfter(0, internal.revert.requeueDuplicateViews, { vectorId: vector._id, cursor: null });
  }
}
