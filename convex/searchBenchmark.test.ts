import { afterEach, beforeEach, expect, it, vi } from "vitest";

import model from "../shared/model/model-version.json";
import { encodeOrbFeatures } from "../shared/orb/features";
import { makeSyntheticPair } from "../shared/orb/test-fixtures";
import { internal } from "./_generated/api";
import { recognitionPartition } from "./lib/recognitionEligibility";
import { seedArtworkWithObject, seedMuseum, testVector } from "./lib/testFactories";
import { harness } from "./test.helpers";

beforeEach(() => {
  vi.stubEnv("PINECONE_API_KEY", "test-secret");
  vi.stubEnv("PINECONE_INDEX_HOST", "test.svc.us-east-1.pinecone.io");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("measures both venue and global searches while excluding incorrectly partitioned IDs", async () => {
  const t = harness();
  const venueId = await t.run(seedMuseum);
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, options) => {
    const request = JSON.parse(options!.body as string);
    return Response.json({
      matches: [
        { id: `id:${request.filter.partition.$eq}`, score: 0.9 },
        { id: "wrong-partition", score: 0.8 },
      ],
      usage: { readUnits: 1 },
    });
  });
  vi.stubGlobal("fetch", fetch);
  const result = await t.action(internal.searchBenchmark.run, { vector: testVector(), venueId });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.established).toEqual([{ id: `id:${recognitionPartition(model.modelVersion)}`, score: 0.9 }]);
  expect(result.tentative).toHaveLength(1);
  expect(result.measurements.map((measurement) => measurement.readUnits)).toEqual([1, 1]);
  expect(result.recognitionMs).toBeNull();
});

it("compares identical candidate sets through recognition without writing scans", async () => {
  const t = harness();
  const pair = makeSyntheticPair({ count: 120 });
  const work = await t.run((ctx) => seedArtworkWithObject(ctx, { descriptors: pair.ref }));
  const matches = [{ id: work.recordId, score: 1 }];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ matches, usage: { readUnits: 1 } })),
  );
  const result = await t.action(internal.searchBenchmark.run, {
    vector: testVector(),
    orb: encodeOrbFeatures(pair.query),
    exact: { established: matches, tentative: [] },
  });
  expect(result.pinecone).toMatchObject({ outcome: "confident", objectId: work.objectId });
  expect(result.exact).toEqual(result.pinecone);
  expect(result.recognitionMs).toBeGreaterThanOrEqual(result.searchMs);
  expect(await t.run((ctx) => ctx.db.query("scans").collect())).toEqual([]);
});

it("rejects an oversized baseline before making any provider requests", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  await expect(
    harness().action(internal.searchBenchmark.run, {
      vector: testVector(),
      exact: { established: Array.from({ length: 33 }, () => ({ id: "x", score: 1 })), tentative: [] },
    }),
  ).rejects.toMatchObject({ data: { code: "bad_candidates" } });
  expect(fetch).not.toHaveBeenCalled();
});

it("exports versioned identities without embedding payloads", async () => {
  const t = harness();
  const work = await t.run((ctx) => seedArtworkWithObject(ctx));
  const result = await t.query(internal.searchBenchmark.corpusPage, { cursor: null });
  expect(result.records).toEqual([
    { id: work.recordId, objectId: work.objectId, partition: recognitionPartition(model.modelVersion) },
  ]);
  expect(result.cursor).toBeNull();
});
