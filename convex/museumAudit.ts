import { ConvexError, type Infer, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { MAX_BATCH_ROWS } from "./ingest";
import { withErrorReporting } from "./lib/observability";
import schema from "./schema";
import { recordVenueChanges } from "./venueChanges";

const record = v.object({
  key: v.string(),
  excludedFromDiscovery: v.boolean(),
  duplicateOf: v.optional(v.string()),
});
const batchArgs = { records: v.array(record) };
const batchResult = v.object({
  changed: v.number(),
  unchanged: v.number(),
  ids: v.record(v.string(), v.id("museums")),
});
const MAX_LOOKUP_KEYS = 100;

function checkKeys(keys: string[], max: number) {
  if (keys.length > max) throw new ConvexError({ code: "batch_too_large" });
  if (keys.some((key) => !key.trim() || key.trim() !== key || key.length > 300)) {
    throw new ConvexError({ code: "invalid_import_file", reason: "museum_key" });
  }
  if (new Set(keys).size !== keys.length) throw new ConvexError({ code: "duplicate_entry" });
}

async function findByKey(ctx: QueryCtx, key: string): Promise<Doc<"museums"> | null> {
  return ctx.db
    .query("museums")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

export const byKeys = internalQuery({
  args: { keys: v.array(v.string()) },
  returns: v.array(v.union(schema.doc("museums"), v.null())),
  handler: async (ctx, { keys }) => {
    checkKeys(keys, MAX_LOOKUP_KEYS);
    return Promise.all(keys.map((key) => findByKey(ctx, key)));
  },
});

export const exportPage = internalQuery({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    page: v.array(schema.doc("museums")),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor }) => {
    const { page, isDone, continueCursor } = await ctx.db
      .query("museums")
      .withIndex("by_key")
      .paginate({ cursor: cursor ?? null, numItems: MAX_BATCH_ROWS });
    return { page, isDone, continueCursor };
  },
});

export const commitBatch = internalMutation({
  args: batchArgs,
  returns: batchResult,
  handler: async (ctx, { records }) => {
    checkKeys(
      records.map(({ key }) => key),
      MAX_BATCH_ROWS,
    );
    const requested = new Map(records.map((row) => [row.key, row]));
    const museums = new Map<string, Doc<"museums">>();
    const requireMuseum = async (key: string) => {
      const museum = museums.get(key) ?? (await findByKey(ctx, key));
      if (!museum) throw new ConvexError({ code: "unknown_key", table: "museums", key });
      museums.set(key, museum);
      return museum;
    };
    const updates = [];
    for (const row of records) {
      const museum = await requireMuseum(row.key);
      let mergedInto: Id<"museums"> | undefined;
      if (row.duplicateOf !== undefined) {
        checkKeys([row.duplicateOf], 1);
        if (!row.excludedFromDiscovery || row.duplicateOf === row.key) {
          throw new ConvexError({ code: "invalid_import_file", reason: "museum_alias" });
        }
        const survivor = await requireMuseum(row.duplicateOf);
        const targetRecord = requested.get(survivor.key);
        if (targetRecord?.duplicateOf !== undefined || (!targetRecord && survivor.mergedInto !== undefined)) {
          throw new ConvexError({ code: "invalid_import_file", reason: "museum_alias_chain" });
        }
        mergedInto = survivor._id;
      }
      updates.push({ museum, excludedFromDiscovery: row.excludedFromDiscovery, mergedInto });
    }
    const changed: Id<"museums">[] = [];
    const ids: Record<string, Id<"museums">> = {};
    for (const { museum, excludedFromDiscovery, mergedInto } of updates) {
      ids[museum.key] = museum._id;
      if ((museum.excludedFromDiscovery ?? false) === excludedFromDiscovery && museum.mergedInto === mergedInto) {
        continue;
      }
      await ctx.db.patch("museums", museum._id, { excludedFromDiscovery, mergedInto });
      changed.push(museum._id);
    }
    await recordVenueChanges(ctx, changed);
    return { changed: changed.length, unchanged: records.length - changed.length, ids };
  },
});

export const applyBatch = internalAction({
  args: batchArgs,
  returns: batchResult,
  handler: (ctx, args): Promise<Infer<typeof batchResult>> =>
    withErrorReporting("museumAudit.applyBatch", () => ctx.runMutation(internal.museumAudit.commitBatch, args)),
});
