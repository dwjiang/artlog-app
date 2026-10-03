import { expect, it } from "vitest";

import model from "../../shared/model/model-version.json";
import { encodeOrbFeatures, type OrbFeatures } from "../../shared/orb/features";
import { makeSyntheticPair } from "../../shared/orb/test-fixtures";
import type { Id } from "../_generated/dataModel";
import type { LoadedCandidate } from "../identify";
import { featureIndex } from "./calibrator/features";
import { DEFAULT_CALIBRATOR } from "./calibrator/weights";
import { runPipeline } from "./identifyPipeline";
import { newObjectCounters } from "./objectCounters";

const pair = makeSyntheticPair({ count: 120 });
const now = 2_000_000;

function candidate(id = "one", similarity = 0.99, features?: OrbFeatures): LoadedCandidate {
  const artworkId = `artwork-${id}` as Id<"artworks">;
  const objectId = id as Id<"objects">;
  return {
    similarity,
    runnerUpSimilarity: 0,
    object: {
      identityStatus: "established" as const,
      _id: objectId,
      _creationTime: 0,
      artworkId,
      key: id,
      source: "corpus",
      sourceId: id,
      ...newObjectCounters,
      reverted: false,
    },
    artwork: {
      identityStatus: "established" as const,
      _id: artworkId,
      _creationTime: 0,
      key: id,
      title: id,
      artist: "Artist",
      rightsStatus: "public_domain",
      multiplicity: "unique",
      enrichGeneration: 0,
    },
    placement: {
      identityStatus: "established",
      _id: `placement-${id}` as Id<"placements">,
      _creationTime: 0,
      objectId,
      venueId: "museum" as Id<"museums">,
      gallery: "4",
      onView: true,
      source: "feed",
      confidence: 1,
    },
    keypointCount: features?.count ?? null,
    ...(features ? { ...encodeOrbFeatures(features), inputSize: model.inputSize } : {}),
  };
}

function run(
  candidates: LoadedCandidate[],
  visit?: { lastConfidentGallery?: string; lastConfidentAt?: number },
  query = pair.query,
) {
  return runPipeline({
    query,
    candidates,
    venueId: "museum",
    visit,
    now,
    inputSize: model.inputSize,
  });
}

it("returns a confident match with verified corners for matching features", () => {
  const match = candidate("one", 0.99, pair.ref);
  const result = run([match]);
  expect(result.decision.outcome).toBe("confident");
  expect(result.verifications.get(match.object._id)).toMatchObject({
    verified: true,
  });
  expect(result.verifications.get(match.object._id)?.corners).toHaveLength(4);
});

it("applies combined corpus and rejection penalties through the configured coefficient", () => {
  const config = {
    ...DEFAULT_CALIBRATOR,
    bias: 0,
    weights: DEFAULT_CALIBRATOR.weights.map((_, i) => (i === featureIndex("objectPenalty") ? -3 : 0)),
  };
  const score = (match: LoadedCandidate) =>
    runPipeline({
      query: pair.query,
      candidates: [match],
      venueId: "museum",
      now,
      inputSize: model.inputSize,
      config,
    }).decision.best!;
  const baseline = candidate("one", 0.93, pair.ref);
  const { probability } = score(baseline);
  for (const [corpus, rejection, effective] of [
    [0.3, 0.2, 0.5],
    [0.7, 0.4, 0.8],
    [0.9, 0.2, 0.9],
  ]) {
    const match = candidate("one", 0.93, pair.ref);
    Object.assign(match.object, {
      calibratorPenalty: corpus,
      rejectionPenalty: rejection,
    });
    const best = score(match);
    expect(best.features[featureIndex("objectPenalty")]).toBeCloseTo(effective);
    expect(best.probability).toBeLessThan(probability);
  }
});

it("keeps a highly similar textured candidate soft without a valid homography", () => {
  const empty: OrbFeatures = {
    count: 0,
    descriptors: new Uint8Array(),
    keypoints: new Float32Array(),
  };
  const result = run([candidate("one", 0.99, pair.ref)], undefined, empty);
  expect(result.decision.outcome).toBe("soft");
  expect(result.decision.best?.reasons).toContain("textured:no-homography");
});

it.each([
  [14, "4", 1, 0],
  [16, "4", 0, 0],
  [15, "4", 1, 0],
  [14, "5", 0, 1],
  [-1, "4", 0, 0],
])("uses gallery context from %s minutes ago (%s)", (minutes, gallery, same, different) => {
  const result = run([candidate()], {
    lastConfidentGallery: gallery,
    lastConfidentAt: now - Number(minutes) * 60_000,
  });
  const { features } = result.decision.best!;
  expect(features[featureIndex("gallerySame")]).toBe(same);
  expect(features[featureIndex("galleryDifferent")]).toBe(different);
});

it("treats missing gallery context as unknown", () => {
  const match = candidate();
  match.placement!.gallery = undefined;
  const result = run([match], {
    lastConfidentGallery: "4",
    lastConfidentAt: now,
  });
  expect(result.decision.best!.features[featureIndex("galleryDifferent")]).toBe(0);
  expect(run([candidate()]).decision.best!.features[featureIndex("gallerySame")]).toBe(0);
});

it("does not infer venue agreement from two absent venues", () => {
  const match = candidate();
  match.placement = null;
  const result = runPipeline({
    query: pair.query,
    candidates: [match],
    now,
    inputSize: model.inputSize,
  });
  expect(result.decision.best!.features[featureIndex("atVenue")]).toBe(0);
  expect(result.decision.outcome).toBe("soft");
});

it("verifies only the ten highest-similarity candidates with descriptors without mutating input", () => {
  const candidates = Array.from({ length: 12 }, (_, i) => candidate(String(i), 0.99 - i / 100, pair.ref)).reverse();
  const ids = candidates.map((c) => c.object._id);
  const result = run(candidates);
  expect(result.verifications.size).toBe(10);
  expect(result.verifications.has("10" as Id<"objects">)).toBe(false);
  expect(result.verifications.has("11" as Id<"objects">)).toBe(false);
  expect(candidates.map((c) => c.object._id)).toEqual(ids);
  expect(result.decision.runnerUps).toHaveLength(5);
});

it("uses the strongest different object for the similarity margin", () => {
  const result = run([candidate("one", 0.99), candidate("two", 0.98)]);
  expect(result.decision.best!.features[featureIndex("margin")]).toBeCloseTo(0.01);
  expect(result.decision.outcome).not.toBe("confident");
});

it("leads each candidate's inliers over the best other verified candidate", () => {
  const blank: OrbFeatures = { count: 0, descriptors: new Uint8Array(), keypoints: new Float32Array() };
  const result = run([candidate("look-alike", 0.97, blank), candidate("painting", 0.95, pair.ref)]);
  const lead = (id: string) =>
    [result.decision.best!, ...result.decision.runnerUps].find((s) => s.candidate.object._id === id)!.features[
      featureIndex("inlierLead")
    ];
  const inliers = result.verifications.get("painting" as Id<"objects">)!.inlierCount;
  expect(inliers).toBeGreaterThan(15);
  expect(lead("painting")).toBeCloseTo(Math.log1p(inliers));
  expect(lead("look-alike")).toBeCloseTo(-Math.log1p(inliers));
});

it("marks the venue as known only when the scan has one", () => {
  expect(run([candidate()]).decision.best!.features[featureIndex("venueKnown")]).toBe(1);
  const away = runPipeline({ query: pair.query, candidates: [candidate()], now, inputSize: model.inputSize });
  expect(away.decision.best!.features[featureIndex("venueKnown")]).toBe(0);
});

it("returns a miss with no candidates", () => {
  expect(run([]).decision).toMatchObject({
    outcome: "miss",
    best: null,
    runnerUps: [],
  });
});

it("caps verified tentative identities at soft and isolates established confidence from their count and scores", () => {
  const established = candidate("corpus", 0.99, pair.ref);
  const tentative = Array.from({ length: 40 }, (_, i) => {
    const entry = candidate(`visitor-${i}`, 0.999, pair.ref);
    entry.object.identityStatus = "tentative";
    entry.object.ownerId = "museum" as Id<"museums">;
    return entry;
  });
  const baseline = run([established]);
  const together = run([...tentative, established]);
  expect(together.decision.outcome).toBe("confident");
  expect(together.decision.best?.candidate.object._id).toBe(established.object._id);
  expect(together.decision.best?.probability).toBe(baseline.decision.best?.probability);
  expect(run([tentative[0]]).decision.outcome).toBe("soft");
});

it("keeps established soft candidates as runner-ups behind a verified tentative suggestion", () => {
  const corpus = candidate("corpus", 0.99);
  const visitor = candidate("visitor", 0.98, pair.ref);
  visitor.object.identityStatus = "tentative";
  visitor.object.ownerId = "museum" as Id<"museums">;
  expect(run([corpus]).decision.outcome).toBe("soft");
  const result = run([corpus, visitor]);
  expect(result.decision.outcome).toBe("soft");
  expect(result.decision.best?.candidate.object._id).toBe(visitor.object._id);
  expect(result.decision.runnerUps.map((c) => c.candidate.object._id)).toEqual([corpus.object._id]);
});

it("requires visual verification and the same museum for a tentative candidate", () => {
  const entry = candidate("visitor", 0.999, pair.ref);
  entry.object.identityStatus = "tentative";
  entry.object.ownerId = "museum" as Id<"museums">;
  expect(run([entry]).decision.outcome).toBe("soft");
  entry.object.ownerId = "elsewhere" as Id<"museums">;
  expect(run([entry]).decision.best).toBeNull();
  entry.object.ownerId = "museum" as Id<"museums">;
  entry.descriptors = undefined;
  entry.keypoints = undefined;
  expect(run([entry]).decision.best).toBeNull();
});
