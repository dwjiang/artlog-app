import { ConvexError } from "convex/values";

import { chooseCrop, RANK_TIMEOUT_MS } from "./crop-choice";
import type { PreparedPainting } from "./stages";

const mockRemove = jest.fn();
jest.mock("@/lib/files/remove-file", () => ({ removeFileIfExists: (uri: string) => mockRemove(uri) }));
const mockReportError = jest.fn();
jest.mock("@/lib/observability", () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }));

const crop = (name: string): PreparedPainting => ({
  cropUri: `file:///${name}.jpg`,
  corners: [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.9],
    [0.1, 0.9],
  ],
  photoSize: { width: 1200, height: 1600 },
  contentBounds: { x: 0, y: 0, width: 512, height: 512 },
  cropSize: 512,
});
const phone = crop("phone");
const painting = crop("painting");
const embedder = {
  modelVersion: "test-model",
  embed: jest.fn(async (uri: string) => new Float32Array([uri.includes("phone") ? 0.1234567 : 0.7654321])),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "debug").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("identifies the crop the ranker picks with its rounded vector and deletes the others", async () => {
  const rank = jest.fn(async () => 1);
  expect(await chooseCrop([phone, painting], embedder, rank)).toEqual({ painting, vector: [0.76543] });
  expect(rank).toHaveBeenCalledWith([[0.12346], [0.76543]]);
  expect(mockRemove.mock.calls).toEqual([[phone.cropUri]]);
});

it("embeds a lone crop without ranking it", async () => {
  const rank = jest.fn(async () => 0);
  expect(await chooseCrop([phone], embedder, rank)).toEqual({ painting: phone, vector: [0.12346] });
  expect(rank).not.toHaveBeenCalled();
  expect(mockRemove).not.toHaveBeenCalled();
});

it.each([
  ["no ranker", undefined],
  ["an index out of range", async () => 5],
  ["a dropped connection", async () => Promise.reject(new Error("Network request failed"))],
  ["a rate limit", async () => Promise.reject(new ConvexError({ code: "rate_limited" }))],
])("keeps the likeliest boundary with %s, silently", async (_case, rank) => {
  expect(await chooseCrop([phone, painting], embedder, rank)).toEqual({ painting: phone, vector: [0.12346] });
  expect(mockRemove.mock.calls).toEqual([[painting.cropUri]]);
  expect(mockReportError).not.toHaveBeenCalled();
});

it("keeps the likeliest boundary when ranking outlasts the timeout", async () => {
  jest.useFakeTimers();
  const choice = chooseCrop([phone, painting], embedder, () => new Promise<number>(() => {}));
  await jest.advanceTimersByTimeAsync(RANK_TIMEOUT_MS);
  expect(await choice).toEqual({ painting: phone, vector: [0.12346] });
  expect(mockReportError).not.toHaveBeenCalled();
});

it("waits for what ranking depends on before its timeout starts", async () => {
  jest.useFakeTimers();
  let settle!: () => void;
  const ready = new Promise<void>((done) => {
    settle = done;
  });
  const rank = jest.fn(() => new Promise<number>((done) => setTimeout(() => done(1), RANK_TIMEOUT_MS / 2)));
  const choice = chooseCrop([phone, painting], embedder, rank, { ready });
  await jest.advanceTimersByTimeAsync(RANK_TIMEOUT_MS);
  expect(rank).not.toHaveBeenCalled();
  settle();
  await jest.advanceTimersByTimeAsync(RANK_TIMEOUT_MS / 2);
  expect(await choice).toEqual({ painting, vector: [0.76543] });
});

it("reports an unexpected ranking failure and keeps the likeliest boundary", async () => {
  const failure = new ConvexError({ code: "bad_candidates" });
  expect(await chooseCrop([phone, painting], embedder, async () => Promise.reject(failure))).toMatchObject({
    painting: phone,
  });
  expect(mockReportError).toHaveBeenCalledWith(failure, "capture.rank_crops", { level: "warning" });
});

it("keeps only the likeliest crop's file when embedding fails", async () => {
  embedder.embed.mockRejectedValueOnce(new Error("model missing"));
  await expect(chooseCrop([phone, painting], embedder, async () => 1)).rejects.toThrow("model missing");
  expect(mockRemove.mock.calls).toEqual([[painting.cropUri]]);
});
