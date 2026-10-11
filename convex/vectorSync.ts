import { ConvexError, v } from "convex/values";

import model from "../shared/model/model-version.json";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { reportBackendError, withErrorReporting } from "./lib/observability";
import { deletePinecone, pineconeHost, PINECONE_NAMESPACE, upsertPinecone, verifyPinecone } from "./lib/pinecone";
import { embedding } from "./lib/validators";
import { readVector } from "./lib/vectorStore";
import { queueVectorSync, searchRecordId } from "./lib/vectorSyncQueue";
import schema from "./schema";

const BATCH_SIZE = 100;
// Longer than a Convex action's maximum lifetime: a timed-out worker cannot race its retry.
const LEASE_MS = 31 * 60_000;
const receipt = v.object({ id: v.id("vectorSyncJobs"), lease: v.string() });
const drainArgs = {
  continuation: v.optional(v.object({ cursor: v.string(), cutoff: v.number() })),
};

// A job's operation is whatever the vectors row says now: a matching row is upserted, anything else is deleted.
async function currentRow(ctx: MutationCtx, job: Doc<"vectorSyncJobs">): Promise<Doc<"vectors"> | null> {
  const row = await ctx.db.get("vectors", job.vectorId);
  return row && searchRecordId(row) === job.recordId ? row : null;
}

// Every other job for the same record is either an in-flight write this job must wait for, or a duplicate
// this job subsumes. Serialising per record keeps a stale upsert from landing after its delete.
async function reserveRecord(ctx: MutationCtx, job: Doc<"vectorSyncJobs">, now: number): Promise<boolean> {
  const siblings = await ctx.db
    .query("vectorSyncJobs")
    .withIndex("by_recordId", (q) => q.eq("recordId", job.recordId))
    .take(BATCH_SIZE);
  const others = siblings.filter((other) => other._id !== job._id);
  if (others.some((other) => other.lease !== undefined && other.availableAt > now)) return false;
  for (const other of others) await ctx.db.delete("vectorSyncJobs", other._id);
  return true;
}

export const claim = internalMutation({
  args: drainArgs,
  returns: v.array(v.object({ job: schema.doc("vectorSyncJobs"), row: v.union(schema.doc("vectors"), v.null()) })),
  handler: async (ctx, { continuation }) => {
    const now = Date.now();
    // Pagination cursors require the same query bounds on every page.
    const cutoff = continuation?.cutoff ?? now;
    const page = await ctx.db
      .query("vectorSyncJobs")
      .withIndex("by_state_availableAt", (q) => q.eq("state", "pending").lte("availableAt", cutoff))
      .paginate({ cursor: continuation?.cursor ?? null, numItems: BATCH_SIZE });
    const claimed = [];
    for (const job of page.page) {
      // A duplicate subsumed earlier in this batch is already gone.
      if (!(await ctx.db.get("vectorSyncJobs", job._id)) || !(await reserveRecord(ctx, job, now))) continue;
      const fields = { lease: crypto.randomUUID(), availableAt: now + LEASE_MS, attempts: job.attempts + 1 };
      await ctx.db.patch("vectorSyncJobs", job._id, fields);
      claimed.push({ job: { ...job, ...fields }, row: await currentRow(ctx, job) });
    }
    // A page can contain only leased or duplicate records; keep advancing to unrelated ready work.
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.vectorSync.drain, {
        continuation: { cursor: page.continueCursor, cutoff },
      });
    }
    return claimed;
  },
});

export const acknowledge = internalMutation({
  args: { receipts: v.array(receipt), success: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { receipts, success }) => {
    let drainAt: number | undefined;
    for (const receipt of receipts) {
      const job = await ctx.db.get("vectorSyncJobs", receipt.id);
      if (!job || job.lease !== receipt.lease) continue;
      if (success) {
        await ctx.db.delete("vectorSyncJobs", job._id);
        // A job queued for this record during the write waited on its lease.
        const waiting = await ctx.db
          .query("vectorSyncJobs")
          .withIndex("by_recordId", (q) => q.eq("recordId", job.recordId))
          .take(BATCH_SIZE);
        if (waiting.some((other) => other.state === "pending")) drainAt = Date.now();
      } else {
        const state = job.attempts >= 8 ? "failed" : "pending";
        // The write may have reached Pinecone: the lease keeps newer jobs for this record waiting.
        await ctx.db.patch("vectorSyncJobs", job._id, { state });
        // Newer jobs can arrive even after the last failure and must wake when its lease ends.
        drainAt = Math.min(drainAt ?? job.availableAt, job.availableAt);
      }
    }
    if (drainAt !== undefined) await ctx.scheduler.runAt(drainAt, internal.vectorSync.drain, {});
    return null;
  },
});

// Each claim chains the next page; acknowledging a lease drains the jobs that waited behind it.
export const drain = internalAction({
  args: drainArgs,
  returns: v.number(),
  handler: async (ctx, args): Promise<number> =>
    withErrorReporting("vectorSync.drain", async () => {
      const batch = await ctx.runMutation(internal.vectorSync.claim, args);
      if (batch.length === 0) return 0;
      const upserts = batch.filter((entry) => entry.row !== null);
      const deletes = batch.filter((entry) => entry.row === null);
      for (const group of [upserts, deletes]) {
        if (group.length === 0) continue;
        let success = false;
        try {
          if (group === upserts) {
            const records = [];
            for (const { job, row } of group) {
              const values = await readVector(ctx, row!);
              records.push({ id: job.recordId, values, metadata: { partition: row!.partition } });
            }
            await upsertPinecone(records);
          } else {
            await deletePinecone(group.map(({ job }) => job.recordId));
          }
          success = true;
        } catch (error) {
          await reportBackendError(error, "vectorSync.write");
        }
        await ctx.runMutation(internal.vectorSync.acknowledge, {
          receipts: group.map(({ job }) => ({ id: job._id, lease: job.lease! })),
          success,
        });
      }
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
    const now = Date.now();
    for (const job of jobs) {
      await ctx.db.patch("vectorSyncJobs", job._id, {
        state: "pending",
        attempts: 0,
        availableAt: Math.max(job.availableAt, now),
      });
    }
    if (jobs.length > 0) {
      // Retried jobs keep waiting out their leases; drain once the earliest becomes available.
      const delay = Math.max(0, Math.min(...jobs.map((job) => job.availableAt)) - now);
      await ctx.scheduler.runAfter(delay, internal.vectorSync.drain, {});
    }
    if (jobs.length === BATCH_SIZE) await ctx.scheduler.runAfter(0, internal.vectorSync.retryFailed, {});
    return jobs.length;
  },
});

export const rebuild = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ queued: v.number(), cursor: v.union(v.string(), v.null()) }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("vectors").withIndex("by_creation_time").paginate({ cursor, numItems: BATCH_SIZE });
    for (const row of page.page) await queueVectorSync(ctx, row);
    return { queued: page.page.length, cursor: page.isDone ? null : page.continueCursor };
  },
});

export const page = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ rows: v.array(schema.doc("vectors")), cursor: v.union(v.string(), v.null()) }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("vectors").withIndex("by_creation_time").paginate({ cursor, numItems: BATCH_SIZE });
    return { rows: page.page, cursor: page.isDone ? null : page.continueCursor };
  },
});

export const exportPage = internalAction({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    records: v.array(v.object({ id: v.string(), values: embedding, metadata: v.object({ partition: v.string() }) })),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: (
    ctx,
    args,
  ): Promise<{ records: { id: string; values: number[]; metadata: { partition: string } }[]; cursor: string | null }> =>
    withErrorReporting("vectorSync.exportPage", async () => {
      const page = await ctx.runQuery(internal.vectorSync.page, args);
      const records = [];
      for (const row of page.rows) {
        records.push({
          id: searchRecordId(row),
          values: await readVector(ctx, row),
          metadata: { partition: row.partition },
        });
      }
      return { records, cursor: page.cursor };
    }),
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

export const corpusRecords = internalQuery({
  args: { keys: corpusKeys },
  returns: v.array(schema.doc("vectors")),
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
        records.push(row);
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
      const rows = await ctx.runQuery(internal.vectorSync.corpusRecords, { keys });
      if (rows.length !== keys.length) return false;
      const records = [];
      for (const row of rows) {
        records.push({
          id: searchRecordId(row),
          values: await readVector(ctx, row),
          metadata: { partition: row.partition },
        });
      }
      return verifyPinecone(records);
    }),
});
