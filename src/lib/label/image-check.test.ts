import { reportError } from "@/lib/observability";
import { encodeOrbFeatures } from "@/shared/orb/features";
import { makeSyntheticPair } from "@/shared/orb/test-fixtures";

import { checkImages, cosineSimilarity, type ImageCheckDeps } from "./image-check";

jest.mock("@/lib/observability", () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const pair = makeSyntheticPair({ count: 120 });
const scan = { vector: [1, 0, 0], ...encodeOrbFeatures(pair.query) };
const inputSize = 512;

function unit(cosine: number): Float32Array {
  return Float32Array.from([cosine, Math.sqrt(1 - cosine * cosine), 0]);
}

function fakeDeps(embeddings: Record<string, Float32Array>, reference = pair.ref) {
  const deps = {
    download: jest.fn(async (url: string) => `file:///cache/${url.split("/").pop()}`),
    letterbox: jest.fn(async (uri: string) => `${uri}.box.jpg`),
    embed: jest.fn(async (uri: string) => embeddings[uri]),
    extractOrb: jest.fn(async () => encodeOrbFeatures(reference)),
    remove: jest.fn(),
  } satisfies ImageCheckDeps;
  return deps;
}

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("passes the closest image once its cosine clears the threshold and the homography holds", async () => {
  const deps = fakeDeps({
    "file:///cache/a.jpg.box.jpg": unit(0.5),
    "file:///cache/b.jpg.box.jpg": unit(0.95),
  });
  const result = await checkImages(["https://museum.example/a.jpg", "https://museum.example/b.jpg"], scan, deps, {
    inputSize,
  });
  expect(result).toMatchObject({
    url: "https://museum.example/b.jpg",
    homographyValid: true,
  });
  expect(result?.cosine).toBeCloseTo(0.95, 5);
  expect(deps.extractOrb).toHaveBeenCalledTimes(1);
  expect(deps.extractOrb).toHaveBeenCalledWith("file:///cache/b.jpg.box.jpg");
  expect(deps.remove.mock.calls.map(([uri]) => uri)).toEqual([
    "file:///cache/a.jpg",
    "file:///cache/a.jpg.box.jpg",
    "file:///cache/b.jpg",
    "file:///cache/b.jpg.box.jpg",
  ]);
});

it("returns null below the threshold without running ORB", async () => {
  const deps = fakeDeps({
    "file:///cache/a.jpg.box.jpg": unit(0.5),
    "file:///cache/b.jpg.box.jpg": unit(0.84),
  });
  expect(
    await checkImages(["https://museum.example/a.jpg", "https://museum.example/b.jpg"], scan, deps, { inputSize }),
  ).toBeNull();
  expect(deps.extractOrb).not.toHaveBeenCalled();
  expect(deps.remove).toHaveBeenCalledTimes(4);
});

it("reports a similar image whose features do not fit a homography", async () => {
  const unrelated = makeSyntheticPair({ seed: 7, count: 120 }).ref;
  const deps = fakeDeps({ "file:///cache/a.jpg.box.jpg": unit(0.9) }, unrelated);
  expect(
    await checkImages(["https://museum.example/a.jpg"], scan, deps, {
      inputSize,
    }),
  ).toMatchObject({
    url: "https://museum.example/a.jpg",
    homographyValid: false,
  });
});

it("checks at most three images and skips one that fails to download", async () => {
  const deps = fakeDeps({
    "file:///cache/a.jpg.box.jpg": unit(0.3),
    "file:///cache/c.jpg.box.jpg": unit(0.9),
    "file:///cache/d.jpg.box.jpg": unit(0.99),
  });
  deps.download
    .mockImplementationOnce(async (url) => `file:///cache/${url.split("/").pop()}`)
    .mockRejectedValueOnce(new Error("HTTP 404"));
  const urls = ["a", "b", "c", "d"].map((name) => `https://museum.example/${name}.jpg`);
  const result = await checkImages(urls, scan, deps, { inputSize });
  expect(deps.download).toHaveBeenCalledTimes(3);
  expect(deps.embed).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({
    url: "https://museum.example/c.jpg",
    homographyValid: true,
  });
  expect(console.warn).toHaveBeenCalledWith("Could not check a museum image", expect.any(Error));
  expect(reportError).toHaveBeenCalledWith(expect.any(Error), "label.check_museum_image", {
    level: "warning",
  });
});

it("measures cosine similarity on unnormalized vectors and rejects mismatched lengths", () => {
  expect(cosineSimilarity([2, 0], Float32Array.from([1, 0]))).toBeCloseTo(1);
  expect(cosineSimilarity([1, 0], [0, 3])).toBe(0);
  expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  expect(() => cosineSimilarity([1], [1, 2])).toThrow("Cannot compare vectors of 1 and 2 values");
});
