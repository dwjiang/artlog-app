import { type Infer, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { bumpCounter } from "./ingest";
import { cosine } from "./lib/cosine";
import { reportBackendError } from "./lib/observability";
import { recognitionPartition } from "./lib/recognitionEligibility";
import { deleteVector, insertArchivedVector, readVector } from "./lib/vectorStore";
import { searchRecordId } from "./lib/vectorSyncQueue";
import { isVenueOptedOut } from "./lib/venueOptOut";
import { getEmbedding } from "./scanEmbeddings";
import schema from "./schema";

const PAGE_ITEMS = 64;
const PAGE_BYTES = 4 * 1024 * 1024;
export const MULTI_VIEW_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const MULTI_VIEW_DUPLICATE_COSINE = 0.982;
const cursorArg = v.union(v.string(), v.null());

const agreementQuery = v.object({
  objectId: v.id("objects"),
  venueId: v.id("museums"),
  since: v.number(),
  cursor: cursorArg,
});
const agreementPage = v.object({
  rows: v.array(v.object({ _id: v.id("feedback"), deviceId: v.id("devices") })),
  cursor: cursorArg,
});

async function readAgreementPage(
  ctx: QueryCtx,
  { objectId, venueId, since, cursor }: Infer<typeof agreementQuery>,
): Promise<Infer<typeof agreementPage>> {
  const page = await ctx.db
    .query("feedback")
    .withIndex("by_resolution_object_venue", (q) =>
      q
        .eq("resolution.kind", "runner_up")
        .eq("resolution.objectId", objectId)
        .eq("venueId", venueId)
        .gte("_creationTime", since),
    )
    .paginate({ cursor, numItems: PAGE_ITEMS, maximumBytesRead: PAGE_BYTES });
  const rows = [];
  for (const row of page.page) {
    const device = await ctx.db.get("devices", row.deviceId);
    if (device && !device.banned) {
      rows.push({ _id: row._id, deviceId: row.deviceId });
    }
  }
  return { rows, cursor: page.isDone ? null : page.continueCursor };
}

export const listMultiViewAgreement = internalQuery({
  args: agreementQuery.fields,
  returns: agreementPage,
  handler: readAgreementPage,
});

type ViewStep = { kind: "done" } | { kind: "page"; cursor: string | null } | { kind: "stale" };
const checkedVector = v.object({ recordId: v.string(), similarity: v.number() });

// Re-read the exact page in the commit transaction so a concurrent insertion or replacement
// cannot turn an external duplicate check into two accepted copies.
async function applyMultiView(
  ctx: MutationCtx,
  row: Doc<"feedback">,
  agreementIds: Id<"feedback">[],
  cursor: string | null,
  checked: Infer<typeof checkedVector>[],
  archiveId: Id<"files"> | null,
): Promise<ViewStep> {
  const done = { kind: "done" } as const;
  const stale = { kind: "stale" } as const;
  const now = Date.now();
  const since = now - MULTI_VIEW_WINDOW_MS;
  if (row.resolution.kind !== "runner_up" || row.multiViewAt !== undefined) {
    return done;
  }
  const object = row.resolution.objectId ? await ctx.db.get("objects", row.resolution.objectId) : null;
  const venue = row.venueId ? await ctx.db.get("museums", row.venueId) : null;
  const device = await ctx.db.get("devices", row.deviceId);
  const takedown =
    object
    && (await ctx.db
      .query("takedowns")
      .withIndex("by_artworkId", (q) => q.eq("target.artworkId", object.artworkId))
      .first());
  if (
    !object
    || object.identityStatus !== "established"
    || object.reverted
    || object.mergedInto
    || !venue
    || (await isVenueOptedOut(ctx, venue))
    || takedown
    || !device
    || device.banned
    || row._creationTime < since
  ) {
    await ctx.db.patch("feedback", row._id, { multiViewAt: now });
    return done;
  }
  const embedding = await getEmbedding(ctx, row.embeddingId);
  if (!embedding) {
    await ctx.db.patch("feedback", row._id, { multiViewAt: now });
    return done;
  }
  if (archiveId !== embedding.archiveId || agreementIds.length !== 2) return stale;
  const devices = new Set<Id<"devices">>();
  for (const id of agreementIds) {
    const partner = await ctx.db.get("feedback", id);
    if (
      !partner
      || partner.resolution.kind !== "runner_up"
      || partner.resolution.objectId !== object._id
      || partner.venueId !== row.venueId
      || partner._creationTime < since
    ) {
      return stale;
    }
    const partnerDevice = await ctx.db.get("devices", partner.deviceId);
    if (!partnerDevice || partnerDevice.banned) return stale;
    devices.add(partner.deviceId);
  }
  if (devices.size !== 2) return stale;
  const page = await ctx.db
    .query("vectors")
    .withIndex("by_objectId_modelVersion_source", (q) =>
      q.eq("objectId", object._id).eq("modelVersion", row.modelVersion).eq("source", "user_scan"),
    )
    .paginate({ cursor, numItems: PAGE_ITEMS, maximumBytesRead: PAGE_BYTES });
  if (
    page.page.length !== checked.length
    || page.page.some((row, index) => searchRecordId(row) !== checked[index].recordId)
  ) {
    return { kind: "page", cursor };
  }
  let duplicate: Doc<"vectors"> | undefined;
  for (const [index, vector] of page.page.entries()) {
    if (checked[index].similarity >= MULTI_VIEW_DUPLICATE_COSINE) {
      duplicate = vector;
      break;
    }
  }
  if (!duplicate && !page.isDone) {
    return { kind: "page", cursor: page.continueCursor };
  }
  const multiViewVectorId = duplicate
    ? undefined
    : await insertArchivedVector(ctx, {
        objectId: object._id,
        modelVersion: row.modelVersion,
        source: "user_scan",
        archiveId: embedding.archiveId,
        contentHash: embedding.contentHash,
        partition: recognitionPartition(row.modelVersion),
        scanId: row.scanId,
        feedbackId: row._id,
      });
  const [firstDeviceId, secondDeviceId] = [...devices];
  await ctx.db.patch("feedback", row._id, {
    multiViewAt: now,
    multiViewVectorId,
    multiViewDuplicateVectorId: duplicate?._id,
    multiViewAgreement: { firstDeviceId, secondDeviceId },
  });
  if (multiViewVectorId) await bumpCounter(ctx, "vectors", 1);
  return done;
}

// Queue every new runner-up resolution; failed external reads retry without marking the view complete.
export async function queueMultiView(
  ctx: MutationCtx,
  rows: Pick<Doc<"feedback">, "resolution" | "venueId">[],
): Promise<void> {
  const groups = new Map<string, { objectId: Id<"objects">; venueId: Id<"museums"> }>();
  for (const { resolution, venueId } of rows) {
    if (resolution.kind === "runner_up" && resolution.objectId && venueId) {
      groups.set(`${resolution.objectId}:${venueId}`, { objectId: resolution.objectId, venueId });
    }
  }
  for (const group of groups.values()) {
    await ctx.scheduler.runAfter(0, internal.promotion.findGroupAgreement, {
      ...group,
      cursor: null,
      witnesses: [],
    });
  }
}

const witness = v.object({ deviceId: v.id("devices"), feedbackId: v.id("feedback") });

export const findGroupAgreement = internalMutation({
  args: {
    objectId: v.id("objects"),
    venueId: v.id("museums"),
    cursor: cursorArg,
    witnesses: v.array(witness),
  },
  returns: v.null(),
  handler: async (ctx, { objectId, venueId, cursor, witnesses }) => {
    const page = await readAgreementPage(ctx, {
      objectId,
      venueId,
      since: Date.now() - MULTI_VIEW_WINDOW_MS,
      cursor,
    });
    const devices = new Map(witnesses.map((row) => [row.deviceId, row.feedbackId]));
    for (const row of page.rows) {
      if (devices.size === 2) break;
      if (!devices.has(row.deviceId)) devices.set(row.deviceId, row._id);
    }
    if (devices.size === 2) {
      await ctx.scheduler.runAfter(0, internal.promotion.promoteNextView, {
        objectId,
        venueId,
        agreementIds: [...devices.values()],
        cursor: null,
      });
    } else if (page.cursor !== null) {
      await ctx.scheduler.runAfter(0, internal.promotion.findGroupAgreement, {
        objectId,
        venueId,
        cursor: page.cursor,
        witnesses: [...devices].map(([deviceId, feedbackId]) => ({ deviceId, feedbackId })),
      });
    }
    return null;
  },
});

export const commitNextView = internalMutation({
  args: {
    objectId: v.id("objects"),
    venueId: v.id("museums"),
    agreementIds: v.array(v.id("feedback")),
    feedbackId: v.id("feedback"),
    cursor: cursorArg,
    checked: v.array(checkedVector),
    archiveId: v.union(v.id("files"), v.null()),
    retryId: v.id("_scheduled_functions"),
  },
  returns: v.null(),
  handler: async (ctx, { objectId, venueId, agreementIds, feedbackId, cursor, checked, archiveId, retryId }) => {
    await ctx.scheduler.cancel(retryId);
    const row = await ctx.db.get("feedback", feedbackId);
    const step = row
      ? await applyMultiView(ctx, row, agreementIds, cursor, checked, archiveId)
      : ({ kind: "done" } as const);
    if (step.kind === "stale") {
      // A witness was banned or aged out after agreement was found.
      await ctx.scheduler.runAfter(0, internal.promotion.findGroupAgreement, {
        objectId,
        venueId,
        cursor: null,
        witnesses: [],
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.promotion.promoteNextView, {
        objectId,
        venueId,
        agreementIds,
        ...(step.kind === "page" ? { feedbackId, cursor: step.cursor } : { cursor: null }),
      });
    }
    return null;
  },
});

const nextViewArgs = {
  objectId: v.id("objects"),
  venueId: v.id("museums"),
  feedbackId: v.optional(v.id("feedback")),
  cursor: cursorArg,
};

export const promoteNextView = internalMutation({
  args: { ...nextViewArgs, agreementIds: v.array(v.id("feedback")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { objectId, venueId, feedbackId, cursor } = args;
    const row = feedbackId
      ? await ctx.db.get("feedback", feedbackId)
      : await ctx.db
          .query("feedback")
          .withIndex("by_resolution_object_venue_multiView", (q) =>
            q
              .eq("resolution.kind", "runner_up")
              .eq("resolution.objectId", objectId)
              .eq("venueId", venueId)
              .eq("multiViewAt", undefined),
          )
          .first();
    if (!row && !feedbackId) return null;
    const page = row
      ? await ctx.db
          .query("vectors")
          .withIndex("by_objectId_modelVersion_source", (q) =>
            q.eq("objectId", objectId).eq("modelVersion", row.modelVersion).eq("source", "user_scan"),
          )
          .paginate({ cursor, numItems: PAGE_ITEMS, maximumBytesRead: PAGE_BYTES })
      : null;
    const selected = { ...args, feedbackId: row?._id ?? feedbackId! };
    // The retry is durable before any external IO and outlives an action's maximum lifetime.
    const retryId = await ctx.scheduler.runAfter(31 * 60_000, internal.promotion.promoteNextView, selected);
    await ctx.scheduler.runAfter(0, internal.promotion.checkNextView, {
      ...selected,
      vectors: page?.page ?? [],
      retryId,
    });
    return null;
  },
});

export const viewEmbedding = internalQuery({
  args: { feedbackId: v.id("feedback") },
  returns: v.union(schema.doc("scanEmbeddings"), v.null()),
  handler: async (ctx, { feedbackId }) => {
    const row = await ctx.db.get("feedback", feedbackId);
    return row && row.multiViewAt === undefined ? getEmbedding(ctx, row.embeddingId) : null;
  },
});

export const checkNextView = internalAction({
  args: {
    ...nextViewArgs,
    feedbackId: v.id("feedback"),
    agreementIds: v.array(v.id("feedback")),
    vectors: v.array(schema.doc("vectors")),
    retryId: v.id("_scheduled_functions"),
  },
  returns: v.null(),
  handler: async (ctx, { vectors, ...args }): Promise<null> => {
    try {
      const archive = await ctx.runQuery(internal.promotion.viewEmbedding, { feedbackId: args.feedbackId });
      const checked: Infer<typeof checkedVector>[] = [];
      if (archive) {
        const candidate = await readVector(ctx, archive);
        for (const row of vectors) {
          checked.push({ recordId: searchRecordId(row), similarity: cosine(await readVector(ctx, row), candidate) });
        }
      }
      await ctx.runMutation(internal.promotion.commitNextView, {
        ...args,
        checked,
        archiveId: archive?.archiveId ?? null,
      });
    } catch (error) {
      await reportBackendError(error, "promotion.checkNextView");
    }
    return null;
  },
});

async function findMultiViewAgreement(
  ctx: ActionCtx,
  objectId: Id<"objects">,
  venueId: Id<"museums">,
): Promise<Id<"feedback">[]> {
  const devices = new Map<Id<"devices">, Id<"feedback">>();
  const since = Date.now() - MULTI_VIEW_WINDOW_MS;
  let cursor: string | null = null;
  do {
    const page: Infer<typeof agreementPage> = await ctx.runQuery(internal.promotion.listMultiViewAgreement, {
      objectId,
      venueId,
      since,
      cursor,
    });
    for (const row of page.rows) {
      devices.set(row.deviceId, row._id);
      if (devices.size === 2) return [...devices.values()];
    }
    cursor = page.cursor;
  } while (cursor !== null);
  return [];
}

export const viewForReassessment = internalQuery({
  args: { feedbackId: v.id("feedback") },
  returns: v.union(v.object({ objectId: v.id("objects"), venueId: v.id("museums") }), v.null()),
  handler: async (ctx, { feedbackId }) => {
    const row = await ctx.db.get("feedback", feedbackId);
    return row?.resolution.kind === "runner_up" && row.resolution.objectId && row.venueId
      ? { objectId: row.resolution.objectId, venueId: row.venueId }
      : null;
  },
});

export const replaceWitnesses = internalMutation({
  args: {
    feedbackId: v.id("feedback"),
    agreementIds: v.array(v.id("feedback")),
  },
  returns: v.null(),
  handler: async (ctx, { feedbackId, agreementIds }) => {
    const row = await ctx.db.get("feedback", feedbackId);
    if (!row) return null;
    const device = await ctx.db.get("devices", row.deviceId);
    const witnesses = new Set<Id<"devices">>();
    for (const id of agreementIds.slice(0, 2)) {
      const partner = await ctx.db.get("feedback", id);
      const source = partner ? await ctx.db.get("devices", partner.deviceId) : null;
      if (
        partner
        && source
        && !source.banned
        && partner.resolution.kind === "runner_up"
        && partner.resolution.objectId === row.resolution.objectId
        && partner.venueId === row.venueId
        && partner._creationTime >= Date.now() - MULTI_VIEW_WINDOW_MS
      ) {
        witnesses.add(partner.deviceId);
      }
    }
    if (device && !device.banned && witnesses.size === 2) {
      const [firstDeviceId, secondDeviceId] = [...witnesses];
      await ctx.db.patch("feedback", row._id, {
        multiViewAgreement: { firstDeviceId, secondDeviceId },
      });
    } else {
      const vector = row.multiViewVectorId ? await ctx.db.get("vectors", row.multiViewVectorId) : null;
      if (vector) {
        await deleteVector(ctx, vector);
        await bumpCounter(ctx, "vectors", -1);
        await ctx.scheduler.runAfter(0, internal.revert.requeueDuplicateViews, {
          vectorId: vector._id,
          cursor: null,
        });
      }
      await ctx.db.patch("feedback", row._id, {
        multiViewAt: device?.banned ? Date.now() : undefined,
        multiViewVectorId: undefined,
        multiViewDuplicateVectorId: undefined,
        multiViewAgreement: undefined,
      });
      // A partner may have resolved while the witnesses above were being reloaded.
      if (!device?.banned) await queueMultiView(ctx, [row]);
    }
    return null;
  },
});

export const reassessView = internalAction({
  args: { feedbackId: v.id("feedback") },
  returns: v.null(),
  handler: async (ctx, { feedbackId }) => {
    const row = await ctx.runQuery(internal.promotion.viewForReassessment, {
      feedbackId,
    });
    const agreementIds = row ? await findMultiViewAgreement(ctx, row.objectId, row.venueId) : [];
    await ctx.runMutation(internal.promotion.replaceWitnesses, {
      feedbackId,
      agreementIds,
    });
    return null;
  },
});
