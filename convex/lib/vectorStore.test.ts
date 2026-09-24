import { expect, it, vi } from "vitest";
import { seedArtworkWithObject, seedDevice, seedMuseum, testVector } from "./testFactories";
import { deleteVector, insertVector, readVector, replaceVector } from "./vectorStore";
import { recognitionPartition } from "./recognitionEligibility";
import { harness } from "../test.helpers";
import model from "../../shared/model/model-version.json";
import { internal } from "../_generated/api";
import { loadCandidates } from "../identify";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { QueryCtx } from "../_generated/server";

it("routes corpus and venue payloads to separate indexes and keeps identities small", async () => {
  const t = harness();
  const { corpus, tentative } = await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx);
    const corpus = await seedArtworkWithObject(ctx);
    const tentative = await insertVector(ctx, {
      objectId: corpus.objectId,
      modelVersion: model.modelVersion,
      partition: recognitionPartition(model.modelVersion, venueId),
      source: "user",
      vector: testVector(0.8),
    });
    return { corpus, tentative };
  });
  await t.run(async (ctx) => {
    const row = (await ctx.db.get(tentative))!;
    expect(ctx.db.normalizeId("tentativeEmbeddings", row.embeddingId)).not.toBeNull();
    expect(ctx.db.normalizeId("embeddings", corpus.embeddingId)).not.toBeNull();
    expect(row).not.toHaveProperty("vector");
    expect(await readVector(ctx, row)).toEqual(testVector(0.8));
    await deleteVector(ctx, row);
    expect(await ctx.db.get(row.embeddingId)).toBeNull();
    expect(await ctx.db.get(row._id)).toBeNull();
    expect(await ctx.db.get(corpus.embeddingId)).not.toBeNull();
  });
});

it("resolves candidates from identity rows without reading any embedding payload", async () => {
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
    const result = await handler(ctx, { embeddingIds: [work.embeddingId], scores: [0.95], now: Date.now() });
    expect(result[0].object._id).toBe(work.objectId);
    expect(get.mock.calls.flat()).not.toContain(work.embeddingId);
    get.mockRestore();
  });
});

it("skips unchanged vectors without payload reads or writes, and updates a changed payload once", async () => {
  const t = harness();
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  await t.run(async (ctx) => {
    const row = (await ctx.db.get(work.vectorId))!;
    const { _id, _creationTime: _time, embeddingId: _embeddingId, contentHash: _hash, ...identity } = row;
    const get = vi.spyOn(ctx.db, "get");
    const replace = vi.spyOn(ctx.db, "replace");
    await replaceVector(ctx, row, { ...identity, vector: testVector() });
    expect(get).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    await replaceVector(ctx, row, { ...identity, vector: testVector(0.8) });
    expect(replace).toHaveBeenCalledTimes(2);
    expect(await readVector(ctx, row)).toEqual(testVector(0.8));
    get.mockRestore();
    replace.mockRestore();
  });
});

it("replaces optional metadata and moves payloads when an identity changes partitions", async () => {
  const t = harness();
  await t.run(async (ctx) => {
    const venueId = await seedMuseum(ctx);
    const work = await seedArtworkWithObject(ctx);
    await ctx.db.patch(work.vectorId, { viewKey: "old-view" });
    const row = (await ctx.db.get(work.vectorId))!;
    const {
      _id,
      _creationTime: _time,
      embeddingId: _embeddingId,
      contentHash: _hash,
      viewKey: _viewKey,
      ...identity
    } = row;
    await replaceVector(ctx, row, { ...identity, vector: testVector() });
    const withoutView = (await ctx.db.get(_id))!;
    expect(withoutView.viewKey).toBeUndefined();
    await replaceVector(ctx, withoutView, {
      objectId: row.objectId,
      modelVersion: row.modelVersion,
      source: "user",
      partition: recognitionPartition(row.modelVersion, venueId),
      vector: testVector(),
    });
    const updated = (await ctx.db.get(row._id))!;
    expect(updated.viewKey).toBeUndefined();
    expect(ctx.db.normalizeId("tentativeEmbeddings", updated.embeddingId)).not.toBeNull();
    expect(await ctx.db.get(row.embeddingId)).toBeNull();
    expect(await readVector(ctx, updated)).toEqual(testVector());
  });
});
