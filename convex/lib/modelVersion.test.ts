import { afterEach, expect, it, vi } from "vitest";

import model from "../../shared/model/model-version.json";
import { expectedDim, isSupported, supportedModelVersions, validateVector } from "./modelVersion";

afterEach(() => vi.unstubAllEnvs());

it("supports the bundled model when no allowlist is configured", () => {
  vi.stubEnv("SUPPORTED_MODEL_VERSIONS", undefined);
  expect(supportedModelVersions()).toEqual([model.modelVersion]);
  expect(isSupported(model.modelVersion)).toBe(true);
  expect(isSupported("obsolete")).toBe(false);
});

it("trims and deduplicates the configured allowlist", () => {
  vi.stubEnv("SUPPORTED_MODEL_VERSIONS", " model-a, model-b, ,model-a ");
  expect(supportedModelVersions()).toEqual(["model-a", "model-b"]);
  expect(isSupported(model.modelVersion)).toBe(false);
  expect(isSupported("model-b")).toBe(true);
});

it("treats an explicitly empty allowlist as supporting no versions", () => {
  vi.stubEnv("SUPPORTED_MODEL_VERSIONS", " , ");
  expect(supportedModelVersions()).toEqual([]);
});

it("requires the bundled embedding dimension", () => {
  expect(expectedDim()).toBe(model.embeddingDim);
  expect(() => validateVector(Array(model.embeddingDim).fill(1))).not.toThrow();
  expect(() => validateVector([1])).toThrowError();
});

it.each([NaN, Infinity, -Infinity])("rejects a non-finite vector coordinate: %s", (value) => {
  const vector = Array(model.embeddingDim).fill(1);
  vector[0] = value;
  expect(() => validateVector(vector)).toThrowError();
});

it("rejects a zero vector whose cosine similarity is undefined", () => {
  expect(() => validateVector(Array(model.embeddingDim).fill(0))).toThrowError();
});
