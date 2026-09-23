import { withErrorReporting } from "./lib/observability";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { bumpCounter } from "./ingest";
import { cosine } from "./lib/cosine";
import { recognitionPartition } from "./lib/recognitionEligibility";
import { isVenueOptedOut } from "./lib/venueOptOut";

export const MULTI_VIEW_PAGE_SIZE = 100;
const PAGE_ITEMS = 64;
const PAGE_BYTES = 4 * 1024 * 1024;
export const MULTI_VIEW_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const MULTI_VIEW_DUPLICATE_COSINE = 0.995;
const cursorArg = v.union(v.string(), v.null());

const multiViewCandidate = v.object({
  _id: v.id("feedback"),
  objectId: v.id("objects"),
  venueId: v.optional(v.id("museums")),
});
type MultiViewCandidate = Infer<typeof multiViewCandidate>;
const multiViewPage = v.object({ rows: v.array(multiViewCandidate), cursor: cursorArg });

export const readMultiViewCursor = internalQuery({
  args: {},
  returns: cursorArg,
  handler: async (ctx) => (await ctx.db.query("promotionState").first())?.multiViewCursor ?? null,
});

export const advanceMultiViewCursor = internalMutation({
  args: { from: cursorArg, to: cursorArg },
  returns: v.null(),
  handler: async (ctx, { from, to }) => {
    const state = await ctx.db.query("promotionState").first();
    // A manually invoked run may overlap the cron; an older run must not rewind its cursor.
    if ((state?.multiViewCursor ?? null) !== from) return null;
    if (state) await ctx.db.patch(state._id, { multiViewCursor: to });
    else await ctx.db.insert("promotionState", { multiViewCursor: to });
    return null;
  },
});

export const listMultiViewCandidates = internalQuery({
  args: { cursor: cursorArg, limit: v.number() },
  returns: multiViewPage,
  handler: async (ctx, { cursor, limit }) => {
    const result = await ctx.db
      .query("feedback")
      .withIndex("by_resolution_multiView", (q) =>
        q.eq("resolution.kind", "runner_up").eq("multiViewAt", undefined),
      )
      .paginate({
        cursor,
        numItems: Math.max(1, Math.min(PAGE_ITEMS, limit)),
        maximumBytesRead: PAGE_BYTES,
      });
    return {
      rows: result.page.map((row) => ({
        _id: row._id,
        objectId: row.resolution.objectId!,
        venueId: row.venueId,
      })),
      cursor: result.isDone ? null : result.continueCursor,
    };
  },
});

const agreementPage = v.object({
  rows: v.array(v.object({ _id: v.id("feedback"), deviceId: v.id("devices") })),
  cursor: cursorArg,
});

export const listMultiViewAgreement = internalQuery({
  args: {
    objectId: v.id("objects"),
    venueId: v.id("museums"),
    since: v.number(),
    cursor: cursorArg,
  },
  returns: agreementPage,
  handler: async (ctx, { objectId, venueId, since, cursor }) => {
    const page = await ctx.db
      .query("feedback")
      .withIndex("by_resolution_object_venue", (q) =>
        q
          .eq("resolution.kind", "runner_up")
          .eq("resolution.objectId", objectId)
          .eq("venueId", venueId)
          .gte("createdAt", since),
      )
      .paginate({ cursor, numItems: PAGE_ITEMS, maximumBytesRead: PAGE_BYTES });
    const rows = [];
    for (const row of page.page) {
      const device = await ctx.db.get(row.deviceId);
      if (device && !device.banned) rows.push({ _id: row._id, deviceId: row.deviceId });
    }
    return { rows, cursor: page.isDone ? null : page.continueCursor };
  },
});

const multiViewResult = v.object({ inserted: v.boolean(), cursor: cursorArg });

// Each transaction checks one feedback row against one page of existing views. New views append
// to this index, so the final page's range read also serializes concurrent duplicate insertions.
export const applyMultiView = internalMutation({
  args: {
    feedbackId: v.id("feedback"),
    agreementIds: v.array(v.id("feedback")),
    cursor: cursorArg,
  },
  returns: multiViewResult,
  handler: async (ctx, { feedbackId, agreementIds, cursor }) => {
    const done = { inserted: false, cursor: null };
    const now = Date.now();
    const since = now - MULTI_VIEW_WINDOW_MS;
    const row = await ctx.db.get(feedbackId);
    if (!row || row.resolution.kind !== "runner_up" || row.multiViewAt !== undefined) return done;
    const object = row.resolution.objectId ? await ctx.db.get(row.resolution.objectId) : null;
    const venue = row.venueId ? await ctx.db.get(row.venueId) : null;
    const device = await ctx.db.get(row.deviceId);
    const takedown =
      object &&
      (await ctx.db
        .query("takedowns")
        .withIndex("by_artworkId", (q) => q.eq("artworkId", object.artworkId))
        .first());
    if (
      !object ||
      object.identityStatus !== "established" ||
      object.reverted ||
      object.mergedInto ||
      !venue ||
      (await isVenueOptedOut(ctx, venue)) ||
      takedown ||
      !device ||
      device.banned ||
      row.createdAt < since
    ) {
      await ctx.db.patch(row._id, { multiViewAt: now });
      return done;
    }
    if (agreementIds.length !== 2) return done;
    const devices = new Set<Id<"devices">>();
    for (const id of agreementIds) {
      const partner = await ctx.db.get(id);
      if (
        !partner ||
        partner.resolution.kind !== "runner_up" ||
        partner.resolution.objectId !== object._id ||
        partner.venueId !== row.venueId ||
        partner.createdAt < since
      )
        return done;
      const partnerDevice = await ctx.db.get(partner.deviceId);
      if (!partnerDevice || partnerDevice.banned) return done;
      devices.add(partner.deviceId);
    }
    if (devices.size !== 2) return done;
    const page = await ctx.db
      .query("vectors")
      .withIndex("by_objectId_modelVersion_source", (q) =>
        q.eq("objectId", object._id).eq("modelVersion", row.modelVersion).eq("source", "user_scan"),
      )
      .paginate({ cursor, numItems: PAGE_ITEMS, maximumBytesRead: PAGE_BYTES });
    const duplicate = page.page.find(
      (vector) => cosine(vector.vector, row.vector) >= MULTI_VIEW_DUPLICATE_COSINE,
    );
    if (!duplicate && !page.isDone) return { inserted: false, cursor: page.continueCursor };
    const multiViewVectorId = duplicate
      ? undefined
      : await ctx.db.insert("vectors", {
          objectId: object._id,
          modelVersion: row.modelVersion,
          source: "user_scan",
          vector: row.vector,
          partition: recognitionPartition(row.modelVersion),
          scanId: row.scanId,
          feedbackId: row._id,
        });
    const [firstDeviceId, secondDeviceId] = [...devices];
    await ctx.db.patch(row._id, {
      multiViewAt: now,
      multiViewVectorId,
      multiViewDuplicateVectorId: duplicate?._id,
      multiViewAgreement: { firstDeviceId, secondDeviceId },
    });
    if (multiViewVectorId) await bumpCounter(ctx, "vectors", 1);
    return { inserted: multiViewVectorId !== undefined, cursor: null };
  },
});

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group) group.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
}

async function findMultiViewAgreement(
  ctx: ActionCtx,
  objectId: Id<"objects">,
  venueId: Id<"museums">,
): Promise<Id<"feedback">[]> {
  const devices = new Map<Id<"devices">, Id<"feedback">>();
  const since = Date.now() - MULTI_VIEW_WINDOW_MS;
  let cursor: string | null = null;
  do {
    const page: Infer<typeof agreementPage> = await ctx.runQuery(
      internal.promotion.listMultiViewAgreement,
      { objectId, venueId, since, cursor },
    );
    for (const row of page.rows) {
      devices.set(row.deviceId, row._id);
      if (devices.size === 2) return [...devices.values()];
    }
    cursor = page.cursor;
  } while (cursor !== null);
  return [];
}

async function promoteMultiView(ctx: ActionCtx): Promise<number> {
  const from = await ctx.runQuery(internal.promotion.readMultiViewCursor, {});
  let cursor = from;
  const rows: MultiViewCandidate[] = [];
  do {
    const page: Infer<typeof multiViewPage> = await ctx.runQuery(
      internal.promotion.listMultiViewCandidates,
      { cursor, limit: MULTI_VIEW_PAGE_SIZE - rows.length },
    );
    rows.push(...page.rows);
    cursor = page.cursor;
  } while (cursor !== null && rows.length < MULTI_VIEW_PAGE_SIZE);
  let inserted = 0;
  const groups = groupBy(rows, (row) => `${row.objectId}:${row.venueId ?? ""}`);
  for (const group of groups.values()) {
    const { objectId, venueId } = group[0];
    const agreementIds = venueId ? await findMultiViewAgreement(ctx, objectId, venueId) : [];
    for (const row of group) {
      let vectorCursor: string | null = null;
      do {
        const result: Infer<typeof multiViewResult> = await ctx.runMutation(
          internal.promotion.applyMultiView,
          { feedbackId: row._id, agreementIds, cursor: vectorCursor },
        );
        inserted += Number(result.inserted);
        vectorCursor = result.cursor;
      } while (vectorCursor !== null);
    }
  }
  await ctx.runMutation(internal.promotion.advanceMultiViewCursor, { from, to: cursor });
  return inserted;
}

export const runSummary = v.object({
  multiViewVectors: v.number(),
});

// Cron every ten minutes (convex/crons.ts); also `npx convex run promotion:run`.
export const run = internalAction({
  args: {},
  returns: runSummary,
  handler: async (ctx) =>
    withErrorReporting("promotion.run", async () => {
      const multiViewVectors = await promoteMultiView(ctx);
      return { multiViewVectors };
    }),
});

export const viewForReassessment = internalQuery({
  args: { feedbackId: v.id("feedback") },
  returns: v.union(v.object({ objectId: v.id("objects"), venueId: v.id("museums") }), v.null()),
  handler: async (ctx, { feedbackId }) => {
    const row = await ctx.db.get(feedbackId);
    return row?.resolution.kind === "runner_up" && row.resolution.objectId && row.venueId
      ? { objectId: row.resolution.objectId, venueId: row.venueId }
      : null;
  },
});

export const replaceWitnesses = internalMutation({
  args: { feedbackId: v.id("feedback"), agreementIds: v.array(v.id("feedback")) },
  returns: v.null(),
  handler: async (ctx, { feedbackId, agreementIds }) => {
    const row = await ctx.db.get(feedbackId);
    if (!row) return null;
    const device = await ctx.db.get(row.deviceId);
    const witnesses = new Set<Id<"devices">>();
    for (const id of agreementIds.slice(0, 2)) {
      const partner = await ctx.db.get(id);
      const source = partner ? await ctx.db.get(partner.deviceId) : null;
      if (
        partner &&
        source &&
        !source.banned &&
        partner.resolution.kind === "runner_up" &&
        partner.resolution.objectId === row.resolution.objectId &&
        partner.venueId === row.venueId &&
        partner.createdAt >= Date.now() - MULTI_VIEW_WINDOW_MS
      )
        witnesses.add(partner.deviceId);
    }
    if (device && !device.banned && witnesses.size === 2) {
      const [firstDeviceId, secondDeviceId] = [...witnesses];
      await ctx.db.patch(row._id, { multiViewAgreement: { firstDeviceId, secondDeviceId } });
    } else {
      const vector = row.multiViewVectorId ? await ctx.db.get(row.multiViewVectorId) : null;
      if (vector) {
        await ctx.db.delete(vector._id);
        await bumpCounter(ctx, "vectors", -1);
        await ctx.scheduler.runAfter(0, internal.revert.requeueDuplicateViews, {
          vectorId: vector._id,
          cursor: null,
        });
      }
      await ctx.db.patch(row._id, {
        multiViewAt: device?.banned ? Date.now() : undefined,
        multiViewVectorId: undefined,
        multiViewDuplicateVectorId: undefined,
        multiViewAgreement: undefined,
      });
    }
    return null;
  },
});

export const reassessView = internalAction({
  args: { feedbackId: v.id("feedback") },
  returns: v.null(),
  handler: async (ctx, { feedbackId }) => {
    const row = await ctx.runQuery(internal.promotion.viewForReassessment, { feedbackId });
    const agreementIds = row ? await findMultiViewAgreement(ctx, row.objectId, row.venueId) : [];
    await ctx.runMutation(internal.promotion.replaceWitnesses, { feedbackId, agreementIds });
    return null;
  },
});
