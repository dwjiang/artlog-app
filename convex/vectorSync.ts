import { ConvexError, v } from "convex/values";

import model from "../shared/model/model-version.json";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { reportBackendError, withErrorReporting } from "./lib/observability";
import { deletePinecone, pineconeHost, PINECONE_NAMESPACE, upsertPinecone, verifyPinecone } from "./lib/pinecone";
import { embedding } from "./lib/validators";
import { readVector } from "./lib/vectorStore";
import { queueVectorSync, searchRecordId } from "./lib/vectorSyncQueue";
import schema from "./schema";

const BATCH_SIZE = 100;
// Longer than a Convex action's maximum lifetime: a timed-out worker cannot race its retry.
const LEASE_MS = 31 * 60_000;
const receipt = v.object({ id: v.id("vectorSyncJobs"), lease: v.string(), revision: v.number() });

export const claim = internalMutation({
  args: {},
  returns: v.array(
    v.object({ job: schema.doc("vectorSyncJobs"), vector: v.union(embedding, v.null()), partition: v.string() }),
  ),
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("vectorSyncJobs")
      .withIndex("by_state_availableAt", (q) => q.eq("state", "pending").lte("availableAt", Date.now()))
      .take(BATCH_SIZE);
    return Promise.all(
      jobs.map(async (job) => {
        const row = await ctx.db.get("vectors", job.vectorId);
        const vector =
          job.operation === "upsert" && row && searchRecordId(row) === job.recordId ? await readVector(ctx, row) : null;
        const lease = crypto.randomUUID();
        const fields = { lease, availableAt: Date.now() + LEASE_MS, attempts: job.attempts + 1 };
        await ctx.db.patch("vectorSyncJobs", job._id, fields);
        return { job: { ...job, ...fields }, vector, partition: row?.partition ?? "" };
      }),
    );
  },
});

export const acknowledge = internalMutation({
  args: { receipts: v.array(receipt), success: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { receipts, success }) => {
    for (const receipt of receipts) {
      const job = await ctx.db.get("vectorSyncJobs", receipt.id);
      if (!job || job.lease !== receipt.lease) continue;
      if (success && job.revision === receipt.revision) {
        await ctx.db.delete("vectorSyncJobs", job._id);
      } else {
        await ctx.db.patch("vectorSyncJobs", job._id, {
          lease: success ? undefined : job.lease,
          state: !success && job.attempts >= 8 ? "failed" : "pending",
          // Failed requests may have reached Pinecone. Keep their lease before sending a newer operation.
          availableAt: success ? Date.now() : job.availableAt,
        });
      }
    }
    return null;
  },
});

export const wake = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const next = await ctx.db
      .query("vectorSyncJobs")
      .withIndex("by_state_availableAt", (q) => q.eq("state", "pending"))
      .first();
    if (next) await ctx.scheduler.runAfter(Math.max(0, next.availableAt - Date.now()), internal.vectorSync.drain, {});
    return null;
  },
});

export const drain = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> =>
    withErrorReporting("vectorSync.drain", async () => {
      const batch = await ctx.runMutation(internal.vectorSync.claim, {});
      if (batch.length === 0) return 0;
      const upserts = batch.filter((entry) => entry.vector !== null);
      const deletes = batch.filter((entry) => entry.vector === null);
      for (const group of [upserts, deletes]) {
        if (group.length === 0) continue;
        let success = false;
        try {
          if (group === upserts) {
            await upsertPinecone(
              group.map(({ job, vector, partition }) => ({
                id: job.recordId,
                values: vector!,
                metadata: { partition },
              })),
            );
          } else {
            await deletePinecone(group.map(({ job }) => job.recordId));
          }
          success = true;
        } catch (error) {
          await reportBackendError(error, "vectorSync.write");
        }
        await ctx.runMutation(internal.vectorSync.acknowledge, {
          receipts: group.map(({ job }) => ({ id: job._id, lease: job.lease!, revision: job.revision })),
          success,
        });
      }
      await ctx.runMutation(internal.vectorSync.wake, {});
      return batch.length;
    }),
});

export const status = internalQuery({
  args: {},
  returns: v.object({
    ready: v.boolean(),
    pending: v.boolean(),
    failed: v.boolean(),
    nextAttemptAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("vectorSyncJobs")
      .withIndex("by_state_availableAt", (q) => q.eq("state", "pending"))
      .first();
    const failed = await ctx.db
      .query("vectorSyncJobs")
      .withIndex("by_state_availableAt", (q) => q.eq("state", "failed"))
      .first();
    return {
      ready: !pending && !failed,
      pending: !!pending,
      failed: !!failed,
      nextAttemptAt: pending?.availableAt ?? null,
    };
  },
});

export const retryFailed = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("vectorSyncJobs")
      .withIndex("by_state_availableAt", (q) => q.eq("state", "failed"))
      .take(BATCH_SIZE);
    for (const job of jobs) {
      await ctx.db.patch("vectorSyncJobs", job._id, {
        state: "pending",
        attempts: 0,
        availableAt: Math.max(job.availableAt, Date.now()),
      });
    }
    if (jobs.length > 0) await ctx.scheduler.runAfter(0, internal.vectorSync.wake, {});
    if (jobs.length === BATCH_SIZE) await ctx.scheduler.runAfter(0, internal.vectorSync.retryFailed, {});
    return jobs.length;
  },
});

export const rebuild = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ queued: v.number(), cursor: v.union(v.string(), v.null()) }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("vectors").withIndex("by_creation_time").paginate({ cursor, numItems: BATCH_SIZE });
    for (const row of page.page) await queueVectorSync(ctx, row, "upsert");
    return { queued: page.page.length, cursor: page.isDone ? null : page.continueCursor };
  },
});

export const exportPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    records: v.array(v.object({ id: v.string(), values: embedding, metadata: v.object({ partition: v.string() }) })),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("vectors").withIndex("by_creation_time").paginate({ cursor, numItems: BATCH_SIZE });
    const records = await Promise.all(
      page.page.map(async (row) => ({
        id: searchRecordId(row),
        values: await readVector(ctx, row),
        metadata: { partition: row.partition },
      })),
    );
    return { records, cursor: page.isDone ? null : page.continueCursor };
  },
});

export const configuration = internalAction({
  args: {},
  returns: v.object({ host: v.string(), namespace: v.string(), dimensions: v.number(), modelVersion: v.string() }),
  handler: async () => ({
    host: pineconeHost(),
    namespace: PINECONE_NAMESPACE,
    dimensions: model.embeddingDim,
    modelVersion: model.modelVersion,
  }),
});

const corpusKeys = v.array(v.object({ modelVersion: v.string(), viewKey: v.string() }));
const searchRecord = v.object({ id: v.string(), values: embedding, metadata: v.object({ partition: v.string() }) });

export const corpusRecords = internalQuery({
  args: { keys: corpusKeys },
  returns: v.array(searchRecord),
  handler: async (ctx, { keys }) => {
    if (keys.length > 32) throw new ConvexError({ code: "batch_too_large" });
    const records = [];
    for (const key of keys) {
      const row = await ctx.db
        .query("vectors")
        .withIndex("by_modelVersion_source_viewKey", (q) =>
          q.eq("modelVersion", key.modelVersion).eq("source", "corpus").eq("viewKey", key.viewKey),
        )
        .unique();
      if (row) {
        records.push({
          id: searchRecordId(row),
          values: await readVector(ctx, row),
          metadata: { partition: row.partition },
        });
      }
    }
    return records;
  },
});

export const verifyCorpus = internalAction({
  args: { keys: corpusKeys },
  returns: v.boolean(),
  handler: async (ctx, { keys }): Promise<boolean> =>
    withErrorReporting("vectorSync.verifyCorpus", async () => {
      const records = await ctx.runQuery(internal.vectorSync.corpusRecords, { keys });
      return records.length === keys.length && (await verifyPinecone(records));
    }),
});
