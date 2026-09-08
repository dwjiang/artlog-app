import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { vectorFields } from "./schema";

export const insertBatch = internalMutation({
  args: {
    modelVersion: v.string(),
    seed: v.number(),
    start: v.number(),
    rows: v.array(v.object(vectorFields)),
  },
  returns: v.object({ inserted: v.number(), nextRow: v.number() }),
  handler: async (ctx, { modelVersion, seed, start, rows }) => {
    if (!Number.isSafeInteger(start) || start < 0 || rows.length < 1 || rows.length > 1000) {
      throw new Error("Invalid batch range");
    }
    const progress = await ctx.db.query("progress")
      .withIndex("by_modelVersion", (q) => q.eq("modelVersion", modelVersion)).unique();
    if (progress && (progress.seed !== seed || progress.deleting)) {
      throw new Error("Seed changed or version is being deleted");
    }
    const nextRow = progress?.nextRow ?? 0;
    if (start < nextRow && start + rows.length <= nextRow) {
      return { inserted: 0, nextRow };
    }
    if (start !== nextRow) throw new Error("Non-contiguous batch");
    for (const row of rows) {
      if (row.modelVersion !== modelVersion || row.vector.length !== 1536 ||
          row.vector.some((n) => !Number.isFinite(n))) {
        throw new Error("Invalid vector or model version");
      }
      await ctx.db.insert("vectors", row);
    }
    const update = { nextRow: start + rows.length, count: (progress?.count ?? 0) + rows.length };
    if (progress) await ctx.db.patch("progress", progress._id, update);
    else await ctx.db.insert("progress", { modelVersion, seed, deleting: false, ...update });
    return { inserted: rows.length, nextRow: update.nextRow };
  },
});

const metadata = v.object({
  id: v.id("vectors"), objectId: v.string(), modelVersion: v.string(),
});

export const resultMetadata = internalQuery({
  args: { ids: v.array(v.id("vectors")) },
  returns: v.array(metadata),
  handler: async (ctx, { ids }) => {
    if (ids.length > 256) throw new Error("Too many results");
    const rows = await Promise.all(ids.map((id) => ctx.db.get("vectors", id)));
    return rows.flatMap((row) => row ? [{
      id: row._id, objectId: row.objectId, modelVersion: row.modelVersion,
    }] : []);
  },
});

export const search = internalAction({
  args: {
    vector: v.array(v.float64()),
    versions: v.array(v.string()),
    limit: v.number(),
  },
  returns: v.object({
    searchMs: v.number(),
    results: v.array(v.object({ _id: v.id("vectors"), _score: v.number() })),
    metadata: v.array(metadata),
  }),
  handler: async (ctx, { vector, versions, limit }) => {
    if (![32, 256].includes(limit) || versions.length < 1 || versions.length > 2 ||
        vector.length !== 1536 || vector.some((n) => !Number.isFinite(n))) {
      throw new Error("Expected 1536 dimensions, one/two versions, and limit 32/256");
    }
    const start = performance.now();
    const results = await ctx.vectorSearch("vectors", "by_vector", {
      vector, limit,
      filter: (q) => versions.length === 1
        ? q.eq("modelVersion", versions[0])
        : q.or(q.eq("modelVersion", versions[0]), q.eq("modelVersion", versions[1])),
    });
    const searchMs = performance.now() - start;
    // Hydration is outside the timer; deletions may race this separate transaction.
    const rows: { id: typeof results[number]["_id"]; objectId: string; modelVersion: string }[] =
      await ctx.runQuery(internal.bench.resultMetadata, { ids: results.map((r) => r._id) });
    return { searchMs, results, metadata: rows };
  },
});

export const stats = internalQuery({
  args: { versions: v.array(v.string()) },
  returns: v.array(v.object({
    modelVersion: v.string(), seed: v.union(v.number(), v.null()),
    count: v.number(), nextRow: v.number(), deleting: v.boolean(),
  })),
  handler: async (ctx, { versions }) => {
    if (versions.length > 2) throw new Error("At most two versions");
    return await Promise.all(versions.map(async (modelVersion) => {
      const row = await ctx.db.query("progress")
        .withIndex("by_modelVersion", (q) => q.eq("modelVersion", modelVersion)).unique();
      return { modelVersion, seed: row?.seed ?? null, count: row?.count ?? 0,
        nextRow: row?.nextRow ?? 0, deleting: row?.deleting ?? false };
    }));
  },
});

export const deleteVersion = internalMutation({
  args: { modelVersion: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({ deleted: v.number(), scanned: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { modelVersion, paginationOpts }) => {
    if (paginationOpts.numItems < 1 || paginationOpts.numItems > 250) {
      throw new Error("Delete pages must contain 1–250 rows");
    }
    // The production index is object-first; a version-only predicate cannot seek it.
    const page = await ctx.db.query("vectors").withIndex("by_objectId_modelVersion")
      .paginate({ ...paginationOpts, maximumBytesRead: 4 * 1024 * 1024 });
    let deleted = 0;
    for (const row of page.page) {
      if (row.modelVersion === modelVersion) {
        await ctx.db.delete("vectors", row._id);
        deleted++;
      }
    }
    const progress = await ctx.db.query("progress")
      .withIndex("by_modelVersion", (q) => q.eq("modelVersion", modelVersion)).unique();
    if (progress) await ctx.db.patch("progress", progress._id, {
      count: progress.count - deleted, deleting: true,
    });
    return { deleted, scanned: page.page.length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});
