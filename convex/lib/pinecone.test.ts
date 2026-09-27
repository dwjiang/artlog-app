import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { deletePinecone, queryPinecone, upsertPinecone, verifyPinecone, type SearchMeasurement } from "./pinecone";
import { testVector } from "./testFactories";

beforeEach(() => {
  vi.stubEnv("PINECONE_API_KEY", "test-secret");
  vi.stubEnv("PINECONE_INDEX_HOST", "test.svc.us-east-1.pinecone.io");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("requests IDs and cosine scores only, with the exact model/venue partition", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ matches: [{ id: "record", score: -0.25 }] }));
  vi.stubGlobal("fetch", fetch);
  expect(await queryPinecone(testVector(), "partition", 32)).toEqual([{ id: "record", score: -0.25 }]);
  const [url, options] = fetch.mock.calls[0];
  const init = options!;
  expect(url).toBe("https://test.svc.us-east-1.pinecone.io/query");
  expect(JSON.parse(init.body as string)).toMatchObject({
    namespace: "recognition",
    topK: 32,
    filter: { partition: { $eq: "partition" } },
    includeValues: false,
    includeMetadata: false,
  });
  expect((init.headers as Record<string, string>)["X-Pinecone-Api-Version"]).toBe("2025-10");
});

it("reports provider usage and UTF-8 body bytes without changing search results", async () => {
  const body = JSON.stringify({ matches: [{ id: "œuvre", score: 0.9 }], usage: { readUnits: 0.25, egressBytes: 123 } });
  vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body)));
  const observe = vi.fn<(measurement: SearchMeasurement) => void>();
  expect(await queryPinecone(testVector(), "partition", 32, observe)).toEqual([{ id: "œuvre", score: 0.9 }]);
  expect(observe).toHaveBeenCalledWith({
    elapsedMs: expect.any(Number),
    responseBytes: new TextEncoder().encode(body).byteLength,
    readUnits: 0.25,
    egressBytes: 123,
  });
});

it.each([undefined, { readUnits: "1" }, { readUnits: -1 }])(
  "does not fabricate missing or invalid usage",
  async (usage) => {
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ matches: [], usage })));
    const observe = vi.fn<(measurement: SearchMeasurement) => void>();
    await queryPinecone(testVector(), "partition", 32, observe);
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ readUnits: null }));
  },
);

it.each([
  [1.00010204, 1],
  [-1.00010204, -1],
])("clamps approximate cosine score %s before calibration", async (score, expected) => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ matches: [{ id: "x", score }] })),
  );
  expect(await queryPinecone(testVector(), "partition", 3)).toEqual([{ id: "x", score: expected }]);
});

it("rejects numeric overflow in provider scores", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"matches":[{"id":"x","score":1e999}]}')),
  );
  await expect(queryPinecone(testVector(), "partition", 3)).rejects.toMatchObject({
    data: { code: "search_error", reason: "bad_response" },
  });
});

it.each([{}, { matches: [{}] }, { matches: [{ id: "x", score: null }] }, { matches: [{ id: "x", score: "0.9" }] }])(
  "refuses malformed search results",
  async (body) => {
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(body)));
    await expect(queryPinecone(testVector(), "partition", 3)).rejects.toMatchObject({
      data: { code: "search_error", reason: "bad_response" },
    });
  },
);

it("does not send a key to an untrusted host or follow redirects", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("PINECONE_INDEX_HOST", "evil.example/pinecone.io");
  await expect(queryPinecone(testVector(), "p", 3)).rejects.toMatchObject({ data: { code: "search_unconfigured" } });
  expect(fetch).not.toHaveBeenCalled();
});

it("sanitizes provider errors and treats incomplete upserts as failures", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response("test-secret", { status: 429 }))
    .mockResolvedValueOnce(Response.json({ upsertedCount: 0 }));
  vi.stubGlobal("fetch", fetch);
  await expect(deletePinecone(["id"])).rejects.toMatchObject({ data: { code: "search_error", reason: "http_429" } });
  await expect(
    upsertPinecone([{ id: "id", values: testVector(), metadata: { partition: "p" } }]),
  ).rejects.toMatchObject({ data: { code: "search_error", reason: "bad_response" } });
});

it("bounds stalled requests and strips network error details", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("test-secret")));
        }),
    ),
  );
  const pending = queryPinecone(testVector(), "p", 3);
  await Promise.all([
    expect(pending).rejects.toMatchObject({ data: { code: "search_error", reason: "timeout" } }),
    vi.advanceTimersByTimeAsync(15_000),
  ]);
});

it("verifies stored float32 values and partitions, and detects missing vectors", async () => {
  const record = { id: "record:version", values: testVector(0.8), metadata: { partition: "p" } };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({
        vectors: {
          [record.id]: {
            ...record,
            values: record.values.map(Math.fround),
          },
        },
      }),
    )
    .mockResolvedValueOnce(Response.json({ vectors: {} }));
  vi.stubGlobal("fetch", fetch);
  expect(await verifyPinecone([record])).toBe(true);
  expect(await verifyPinecone([record])).toBe(false);
  expect(fetch.mock.calls[0][1]!.method).toBe("GET");
});
