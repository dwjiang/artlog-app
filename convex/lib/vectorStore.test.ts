import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import model from "../../shared/model/model-version.json";
import { internal } from "../_generated/api";
import type { QueryCtx } from "../_generated/server";
import { loadCandidates } from "../identify";
import { deleteEmbedding, insertEmbedding } from "../scanEmbeddings";
import { harness } from "../test.helpers";
import { fileStorage } from "./fileStorage";
import { r2 } from "./r2";
import { recognitionPartition } from "./recognitionEligibility";
import { seedArtworkWithObject, seedDevice, seedMuseum, seedVector, testVector } from "./testFactories";
import {
  deleteVector,
  packVector,
  readVector,
  replaceVector,
  VECTOR_ARCHIVE_GRACE_MS,
  withVectorArchives,
} from "./vectorStore";
import { searchRecordId } from "./vectorSyncQueue";

it("archives imported vectors without a persistent or queued corpus payload in Convex", async () => {
  const t = harness();
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const object = (await t.run((ctx) => ctx.db.get("objects", work.objectId)))!;
  const rows = [
    {
      objectKey: object.key,
      source: "corpus" as const,
      modelVersion: model.modelVersion,
      viewKey: "archive",
      vector: testVector(0.8),
    },
  ];
  const { ids } = await t.action(internal.ingest.upsertVectors, { rows });
  const id = Object.values(ids)[0];
  const row = (await t.run((ctx) => ctx.db.get("vectors", id)))!;
  expect(row.archiveId).toEqual(expect.any(String));
  expect(row).not.toHaveProperty("vector");
  expect(await t.run((ctx) => readVector(ctx, row))).toEqual(rows[0].vector);
  const job = await t.run((ctx) =>
    ctx.db
      .query("vectorSyncJobs")
      .withIndex("by_recordId", (q) => q.eq("recordId", searchRecordId(row)))
      .unique(),
  );
  expect(job).not.toHaveProperty("pendingVector");
  const putCount = vi.mocked(r2.put).mock.calls.length;
  expect(await t.action(internal.ingest.upsertVectors, { rows })).toEqual({ ids });
  expect(vi.mocked(r2.put).mock.calls.length).toBe(putCount);
  await t.run((ctx) => deleteVector(ctx, row));
  expect(await t.run((ctx) => fileStorage.getMetadata(ctx, row.archiveId))).toMatchObject({
    state: "ready",
    expiresAt: expect.any(Number),
  });
});

it("resolves candidates from metadata without reading archives or pending payloads", async () => {
  const t = harness();
  await seedDevice(t);
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const handler = (
    loadCandidates as unknown as {
      _handler: (
        ctx: QueryCtx,
        args: FunctionArgs<typeof internal.identify.loadCandidates>,
      ) => Promise<FunctionReturnType<typeof internal.identify.loadCandidates>>;
    }
  )._handler;
  await t.run(async (ctx) => {
    const get = vi.spyOn(ctx.db, "get");
    const result = await handler(ctx, { recordIds: [work.recordId], scores: [0.95], now: Date.now() });
    expect(result[0].object._id).toBe(work.objectId);
    expect(get.mock.calls.map(([table]) => table)).not.toContain("files");
    expect(get.mock.calls.map(([table]) => table)).not.toContain("vectorSyncJobs");
    get.mockRestore();
  });
});

it("keeps the original archive on unchanged imports and rejects corrupt archive bytes", async () => {
  const t = harness();
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const { archiveId } = (await t.run((ctx) => ctx.db.get("vectors", work.vectorId)))!;
  const row = (await t.run((ctx) => ctx.db.get("vectors", work.vectorId)))!;
  const { _id, _creationTime: _time, contentHash: _hash, ...identity } = row;
  await t.run((ctx) => replaceVector(ctx, row, { ...identity, vector: testVector() }));
  expect((await t.run((ctx) => ctx.db.get("vectors", _id)))?.archiveId).toBe(archiveId);
  await r2.put(archiveId, packVector(testVector(0.8)));
  await expect(t.run((ctx) => readVector(ctx, row))).rejects.toThrow("vector_archive_invalid");
});

it("changes partitions without copying the archive and rejects old search identities", async () => {
  const t = harness();
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const { archiveId } = (await t.run((ctx) => ctx.db.get("vectors", work.vectorId)))!;
  await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx);
    const row = (await ctx.db.get("vectors", work.vectorId))!;
    await replaceVector(ctx, row, {
      archiveId,
      objectId: row.objectId,
      modelVersion: row.modelVersion,
      source: "user",
      partition: recognitionPartition(row.modelVersion, venueId),
      vector: testVector(),
    });
    const updated = (await ctx.db.get("vectors", row._id))!;
    expect(updated.archiveId).toBe(archiveId);
    expect(searchRecordId(updated)).not.toBe(work.recordId);
    expect(await readVector(ctx, updated)).toEqual(testVector());
  });
  expect(
    await t.query(internal.identify.loadCandidates, { recordIds: [work.recordId], scores: [1], now: Date.now() }),
  ).toEqual([]);
});

it("discards unused uploads after a failed commit and preserves an ambiguously committed archive", async () => {
  const t = harness();
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const object = (await t.run((ctx) => ctx.db.get("objects", work.objectId)))!;
  let unused = "";
  await expect(
    t.action((ctx) =>
      withVectorArchives(ctx, [{ vector: testVector(0.8) }], async ([id]) => {
        unused = id;
        throw new Error("commit failed");
      }),
    ),
  ).rejects.toThrow("commit failed");
  expect(await t.run((ctx) => fileStorage.getMetadata(ctx, unused))).toMatchObject({
    state: "ready",
    expiresAt: expect.any(Number),
  });
  let committed = "";
  await expect(
    t.action((ctx) =>
      withVectorArchives(ctx, [{ vector: testVector(0.8) }], async ([id]) => {
        committed = id;
        await t.mutation(internal.ingest.commitVectors, {
          rows: [
            {
              objectKey: object.key,
              source: "corpus",
              modelVersion: model.modelVersion,
              viewKey: "committed",
              archiveId: id,
              vector: testVector(0.8),
            },
          ],
        });
        throw new Error("response lost");
      }),
    ),
  ).rejects.toThrow("response lost");
  expect(await t.run((ctx) => fileStorage.getMetadata(ctx, committed))).not.toBeNull();
});

it("validates and decodes a single-use R2 response without reading its stream twice", async () => {
  const t = harness();
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const row = (await t.run((ctx) => ctx.db.get("vectors", work.vectorId)))!;
  const response = packVector(testVector());
  const bytes = await response.arrayBuffer();
  vi.spyOn(response, "arrayBuffer")
    .mockResolvedValueOnce(bytes)
    .mockRejectedValue(new Error("Can't re-read streaming Blob"));
  vi.mocked(r2.get).mockResolvedValueOnce(response);
  expect(await t.run((ctx) => readVector(ctx, row))).toEqual(testVector());
});

describe("archive retention", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("preserves an archive shared by search and evidence until both references are removed", async () => {
    const t = harness();
    const work = await t.run((ctx) => seedArtworkWithObject(ctx));
    const row = (await t.run((ctx) => ctx.db.get("vectors", work.vectorId)))!;
    const evidenceId = await t.run((ctx) =>
      insertEmbedding(ctx, { archiveId: row.archiveId, contentHash: row.contentHash }),
    );
    await t.run((ctx) => deleteVector(ctx, row));
    await t.mutation(internal.vectorArchives.discard, { ids: [row.archiveId] });
    expect((await t.query(internal.files.metadata, { id: row.archiveId }))?.expiresAt).toBeUndefined();
    await t.run((ctx) => deleteEmbedding(ctx, evidenceId));
    vi.setSystemTime(Date.now() + VECTOR_ARCHIVE_GRACE_MS);
    await t.mutation(internal.files.expire, {});
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    expect(await r2.get(row.archiveId)).toBeNull();
  });

  it.each(["delete", "replace"] as const)(
    "keeps a snapshot readable after %s and eventually removes only the unused archive",
    async (operation) => {
      const t = harness();
      const work = await t.run((ctx) => seedArtworkWithObject(ctx));
      const row = (await t.run((ctx) => ctx.db.get("vectors", work.vectorId)))!;
      if (operation === "delete") {
        await t.run((ctx) => deleteVector(ctx, row));
      } else {
        const archiveId = await t.action((ctx) => fileStorage.store(ctx, packVector(testVector(0.8))));
        const { _id, _creationTime: _time, contentHash: _hash, ...identity } = row;
        await t.run((ctx) => replaceVector(ctx, row, { ...identity, archiveId, vector: testVector(0.8) }));
      }
      vi.setSystemTime(Date.now() + VECTOR_ARCHIVE_GRACE_MS - 1);
      await t.mutation(internal.files.expire, {});
      expect(await t.action((ctx) => readVector(ctx, row))).toEqual(testVector());
      expect(await t.query(internal.files.downloadable, { id: row.archiveId })).toBeNull();
      vi.setSystemTime(Date.now() + 1);
      await t.mutation(internal.files.expire, {});
      await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
      expect(await t.query(internal.files.metadata, { id: row.archiveId })).toBeNull();
      expect(await r2.get(row.archiveId)).toBeNull();
      const current = await t.run((ctx) => ctx.db.get("vectors", row._id));
      const values = current ? await t.action((ctx) => readVector(ctx, current)) : null;
      expect(values).toEqual(operation === "replace" ? testVector(0.8) : null);
    },
  );

  it("cancels expiry when an archive is reused and grants a fresh grace period on its next removal", async () => {
    const t = harness();
    const work = await t.run((ctx) => seedArtworkWithObject(ctx));
    const row = (await t.run((ctx) => ctx.db.get("vectors", work.vectorId)))!;
    await t.run((ctx) => deleteVector(ctx, row));
    const { _id, _creationTime: _time, contentHash: _hash, ...identity } = row;
    const reusedId = await t.run((ctx) => seedVector(ctx, { ...identity, vector: testVector() }));
    expect((await t.query(internal.files.metadata, { id: row.archiveId }))?.expiresAt).toBeUndefined();
    await t.mutation(internal.vectorArchives.discard, { ids: [row.archiveId] });
    vi.setSystemTime(Date.now() + VECTOR_ARCHIVE_GRACE_MS);
    await t.mutation(internal.files.expire, {});
    const reused = (await t.run((ctx) => ctx.db.get("vectors", reusedId)))!;
    expect(await t.action((ctx) => readVector(ctx, reused))).toEqual(testVector());
    await t.run((ctx) => deleteVector(ctx, reused));
    await t.mutation(internal.files.expire, {});
    expect(await t.action((ctx) => readVector(ctx, reused))).toEqual(testVector());
    vi.setSystemTime(Date.now() + VECTOR_ARCHIVE_GRACE_MS);
    await t.mutation(internal.files.expire, {});
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    expect(await t.query(internal.files.metadata, { id: row.archiveId })).toBeNull();
  });
});
