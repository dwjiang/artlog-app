import { afterEach, beforeEach, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { fileStorage } from "./lib/fileStorage";
import { seedArtworkWithObject, testVector } from "./lib/testFactories";
import { deleteVector, packVector, readVector, replaceVector } from "./lib/vectorStore";
import { searchRecordId } from "./lib/vectorSyncQueue";
import { harness } from "./test.helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function receipt(job: Doc<"vectorSyncJobs">) {
  return { id: job._id, lease: job.lease!, revision: job.revision };
}

it("finishes healthy upserts when a claimed vector is deleted before its archive is read", async () => {
  vi.stubEnv("PINECONE_API_KEY", "secret");
  vi.stubEnv("PINECONE_INDEX_HOST", "test.svc.us-east-1.pinecone.io");
  const t = harness({ vectorSync: true });
  const removed = await t.run((ctx) => seedArtworkWithObject(ctx));
  const healthy = await t.run((ctx) => seedArtworkWithObject(ctx));
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ upsertedCount: 2 }));
  vi.stubGlobal("fetch", fetch);
  const { get } = fileStorage;
  const read = vi.spyOn(fileStorage, "get").mockImplementationOnce(async (ctx, id) => {
    await t.run(async (ctx) => deleteVector(ctx, (await ctx.db.get("vectors", removed.vectorId))!));
    return get(ctx, id);
  });
  try {
    await t.action(internal.vectorSync.drain, {});
  } finally {
    read.mockRestore();
  }
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).vectors).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: healthy.recordId, values: testVector() })]),
  );
  const jobs = await t.run((ctx) => ctx.db.query("vectorSyncJobs").collect());
  expect(jobs).toMatchObject([{ vectorId: removed.vectorId, operation: "delete", availableAt: Date.now() }]);
  await t.action(internal.vectorSync.drain, {});
  expect(JSON.parse(fetch.mock.calls[1][1]!.body as string).ids).toEqual([removed.recordId]);
  expect(await t.query(internal.vectorSync.status, {})).toMatchObject({ ready: true });
});

it("keeps a delete queued when it arrives during an upsert, and rejects the stale search match immediately", async () => {
  const t = harness({ vectorSync: true });
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const [claimed] = await t.mutation(internal.vectorSync.claim, {});
  expect(claimed.job).not.toHaveProperty("pendingVector");
  expect(await t.mutation(internal.vectorSync.claim, {})).toEqual([]);
  await t.run(async (ctx) => deleteVector(ctx, (await ctx.db.get("vectors", work.vectorId))!));
  expect(
    await t.query(internal.identify.loadCandidates, { recordIds: [work.recordId], scores: [1], now: Date.now() }),
  ).toEqual([]);
  await t.mutation(internal.vectorSync.acknowledge, { receipts: [receipt(claimed.job)], success: true });
  const [deleted] = await t.mutation(internal.vectorSync.claim, {});
  expect(deleted.job.operation).toBe("delete");
  expect(deleted.row).toBeNull();
  await t.mutation(internal.vectorSync.acknowledge, { receipts: [receipt(deleted.job)], success: true });
  expect(await t.query(internal.vectorSync.status, {})).toMatchObject({ ready: true });
});

it("rejects old embedding revisions, preserves new ones, and skips unchanged reimports", async () => {
  const t = harness({ vectorSync: true });
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const updatedId = await t.run(async (ctx) => {
    const row = (await ctx.db.get("vectors", work.vectorId))!;
    const { _id, _creationTime: _time, contentHash: _hash, ...identity } = row;
    await replaceVector(ctx, row, { ...identity, vector: testVector() });
    expect(await ctx.db.query("vectorSyncJobs").collect()).toHaveLength(1);
    await replaceVector(ctx, row, {
      ...identity,
      archiveId: await fileStorage.store(ctx, packVector(testVector(0.7))),
      vector: testVector(0.7),
    });
    return searchRecordId((await ctx.db.get("vectors", _id))!);
  });
  const candidates = await t.query(internal.identify.loadCandidates, {
    recordIds: [work.recordId, updatedId],
    scores: [1, 0.7],
    now: Date.now(),
  });
  expect(candidates).toHaveLength(1);
  expect(candidates[0].similarity).toBe(0.7);
  const batch = await t.mutation(internal.vectorSync.claim, {});
  expect(batch.map(({ job }) => job.operation).sort()).toEqual(["delete", "upsert"]);
});

it("retries a lost write response after its lease, retaining work through an unavailable provider", async () => {
  vi.stubEnv("PINECONE_API_KEY", "secret");
  vi.stubEnv("PINECONE_INDEX_HOST", "test.svc.us-east-1.pinecone.io");
  const t = harness({ vectorSync: true });
  await t.run((ctx) => seedArtworkWithObject(ctx));
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValue(Response.json({ upsertedCount: 1 }));
  vi.stubGlobal("fetch", fetch);
  expect(await t.action(internal.vectorSync.drain, {})).toBe(1);
  expect(await t.query(internal.vectorSync.status, {})).toMatchObject({ ready: false, pending: true });
  const archived = await t.run((ctx) => ctx.db.query("vectors").first());
  expect(archived?.archiveId).toEqual(expect.any(String));
  const pending = await t.run((ctx) => ctx.db.query("vectorSyncJobs").first());
  expect(pending).not.toHaveProperty("pendingVector");
  expect(await t.run((ctx) => readVector(ctx, archived!))).toEqual(testVector());
  expect(await t.action(internal.vectorSync.drain, {})).toBe(0);
  vi.setSystemTime(Date.now() + 31 * 60_000);
  expect(await t.action(internal.vectorSync.drain, {})).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await t.query(internal.vectorSync.status, {})).toMatchObject({ ready: true });
});

it("does not let an expired worker acknowledge a newer claim", async () => {
  const t = harness({ vectorSync: true });
  await t.run((ctx) => seedArtworkWithObject(ctx));
  const [first] = await t.mutation(internal.vectorSync.claim, {});
  vi.setSystemTime(Date.now() + 31 * 60_000);
  const [second] = await t.mutation(internal.vectorSync.claim, {});
  await t.mutation(internal.vectorSync.acknowledge, { receipts: [receipt(first.job)], success: true });
  expect(await t.query(internal.vectorSync.status, {})).toMatchObject({ pending: true });
  await t.mutation(internal.vectorSync.acknowledge, { receipts: [receipt(second.job)], success: true });
  expect(await t.query(internal.vectorSync.status, {})).toMatchObject({ ready: true });
});

it("retains exhausted jobs for inspection and can retry them after repair", async () => {
  const t = harness({ vectorSync: true });
  await t.run((ctx) => seedArtworkWithObject(ctx));
  for (let i = 0; i < 8; i++) {
    const [batch] = await t.mutation(internal.vectorSync.claim, {});
    await t.mutation(internal.vectorSync.acknowledge, { receipts: [receipt(batch.job)], success: false });
    vi.setSystemTime(Date.now() + 31 * 60_000);
  }
  expect(await t.query(internal.vectorSync.status, {})).toMatchObject({ ready: false, failed: true });
  expect(await t.mutation(internal.vectorSync.retryFailed, {})).toBe(1);
  expect(await t.query(internal.vectorSync.status, {})).toMatchObject({ pending: true, failed: false });
  const [retried] = await t.mutation(internal.vectorSync.claim, {});
  expect(retried.job).not.toHaveProperty("pendingVector");
  expect(retried.job.attempts).toBe(1);
  await t.mutation(internal.vectorSync.acknowledge, { receipts: [receipt(retried.job)], success: true });
  expect(await t.query(internal.vectorSync.status, {})).toMatchObject({ ready: true });
});

it.each(["upsert", "delete"] as const)(
  "preserves an unexpired lease before a manually retried %s",
  async (operation) => {
    const t = harness({ vectorSync: true });
    const work = await t.run((ctx) => seedArtworkWithObject(ctx));
    let availableAt = Date.now();
    for (let attempt = 0; attempt < 8; attempt++) {
      const [claimed] = await t.mutation(internal.vectorSync.claim, {});
      await t.mutation(internal.vectorSync.acknowledge, { receipts: [receipt(claimed.job)], success: false });
      availableAt = claimed.job.availableAt;
      if (attempt < 7) vi.setSystemTime(availableAt);
    }
    expect(await t.query(internal.vectorSync.status, {})).toMatchObject({ failed: true });
    expect(await t.mutation(internal.vectorSync.retryFailed, {})).toBe(1);
    if (operation === "delete") {
      await t.run(async (ctx) => deleteVector(ctx, (await ctx.db.get("vectors", work.vectorId))!));
    }
    expect(await t.query(internal.vectorSync.status, {})).toMatchObject({
      pending: true,
      failed: false,
      nextAttemptAt: availableAt,
    });
    vi.setSystemTime(availableAt - 1);
    expect(await t.mutation(internal.vectorSync.claim, {})).toEqual([]);
    vi.stubEnv("PINECONE_API_KEY", "secret");
    vi.stubEnv("PINECONE_INDEX_HOST", "test.svc.us-east-1.pinecone.io");
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      expect(Date.now()).toBeGreaterThanOrEqual(availableAt);
      return Response.json(operation === "upsert" ? { upsertedCount: 1 } : {});
    });
    vi.stubGlobal("fetch", fetch);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(`https://test.svc.us-east-1.pinecone.io/vectors/${operation}`);
    expect(JSON.parse(options!.body as string)).toMatchObject(
      operation === "delete" ? { ids: [work.recordId] } : { vectors: [{ id: work.recordId, values: testVector() }] },
    );
    expect(await t.query(internal.vectorSync.status, {})).toMatchObject({ ready: true });
  },
);

it("holds a replacement delete behind an ambiguous failed upsert until its lease expires", async () => {
  const t = harness({ vectorSync: true });
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const [claimed] = await t.mutation(internal.vectorSync.claim, {});
  await t.mutation(internal.vectorSync.acknowledge, { receipts: [receipt(claimed.job)], success: false });
  await t.run(async (ctx) => deleteVector(ctx, (await ctx.db.get("vectors", work.vectorId))!));
  expect(await t.mutation(internal.vectorSync.claim, {})).toEqual([]);
  vi.setSystemTime(Date.now() + 31 * 60_000);
  const [deleted] = await t.mutation(internal.vectorSync.claim, {});
  expect(deleted.job.operation).toBe("delete");
});

it("rebuilds Pinecone from archives using only references in the outbox", async () => {
  vi.stubEnv("PINECONE_API_KEY", "secret");
  vi.stubEnv("PINECONE_INDEX_HOST", "test.svc.us-east-1.pinecone.io");
  const t = harness({ vectorSync: true });
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ upsertedCount: 1 }));
  vi.stubGlobal("fetch", fetch);
  await t.action(internal.vectorSync.drain, {});
  expect(await t.run((ctx) => ctx.db.query("vectorSyncJobs").collect())).toEqual([]);
  await t.mutation(internal.vectorSync.rebuild, { cursor: null });
  expect(await t.run((ctx) => ctx.db.query("vectorSyncJobs").first())).not.toHaveProperty("pendingVector");
  await t.action(internal.vectorSync.drain, {});
  const body = JSON.parse(fetch.mock.calls[1][1]!.body as string);
  expect(body.vectors).toEqual([
    {
      id: work.recordId,
      values: testVector(),
      metadata: { partition: JSON.stringify([model.modelVersion, "established"]) },
    },
  ]);
  expect(await t.query(internal.vectorSync.status, {})).toMatchObject({ ready: true });
});

it("reads the existing archive when rebuilding an exhausted job", async () => {
  const t = harness({ vectorSync: true });
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  await t.run(async (ctx) => {
    const job = (await ctx.db.query("vectorSyncJobs").first())!;
    await ctx.db.patch("vectorSyncJobs", job._id, { state: "failed", attempts: 8 });
  });
  await t.mutation(internal.vectorSync.rebuild, { cursor: null });
  const current = (await t.run((ctx) => ctx.db.get("vectors", work.vectorId)))!;
  expect(await t.run((ctx) => readVector(ctx, current))).toEqual(testVector());
});
