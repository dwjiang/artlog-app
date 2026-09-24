import { ConvexError, v } from "convex/values";

import { internalMutation, query } from "./_generated/server";

export const requestUpload = internalMutation({
  args: {},
  returns: v.string(),
  handler: (ctx) => ctx.storage.generateUploadUrl(),
});

export const publish = internalMutation({
  args: {
    storageId: v.id("_storage"),
    rowCount: v.number(),
    version: v.number(),
  },
  returns: v.id("venueTables"),
  handler: async (ctx, { storageId, rowCount, version }) => {
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new ConvexError("Venue table version must be a positive integer");
    }
    if (
      !Number.isSafeInteger(rowCount)
      || rowCount <= 0
      || rowCount > 150_000
    ) {
      throw new ConvexError("Venue table must contain 1–150,000 rows");
    }
    const file = await ctx.db.system.get(storageId);
    if (file === null || file.size === 0 || file.size > 10_000_000) {
      throw new ConvexError(
        "Venue table upload is missing, empty, or exceeds 10 MB",
      );
    }
    const existing = await ctx.db
      .query("venueTables")
      .withIndex("by_version", (q) => q.eq("version", version))
      .unique();
    if (existing !== null) {
      if (existing.storageId !== storageId || existing.rowCount !== rowCount) {
        throw new ConvexError(
          "Venue table version already describes another asset",
        );
      }
      return existing._id;
    }
    return ctx.db.insert("venueTables", {
      storageId,
      rowCount,
      version,
      createdAt: Date.now(),
    });
  },
});

export const latest = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ version: v.number(), rowCount: v.number(), url: v.string() }),
  ),
  handler: async (ctx) => {
    const table = await ctx.db
      .query("venueTables")
      .withIndex("by_version")
      .order("desc")
      .first();
    if (table === null) return null;
    const url = await ctx.storage.getUrl(table.storageId);
    return url === null
      ? null
      : { version: table.version, rowCount: table.rowCount, url };
  },
});
