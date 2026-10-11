import type { Id } from "../../convex/_generated/dataModel";
import model from "../model/model-version.json";
import { encodeOrbFeatures } from "../orb/features";
import { makeSyntheticPair } from "../orb/test-fixtures";
import { rankEntries, recognizeEntries } from "./recognition";
import type { MuseumEntry } from "./types";

const pair = makeSyntheticPair({ seed: 81, count: 120 });
const vector = Array.from({ length: model.embeddingDim }, (_, i) => (i === 0 ? 1 : 0));
const payload = { modelVersion: model.modelVersion, ...encodeOrbFeatures(pair.query) };

function entry(id: string): MuseumEntry {
  return {
    vectors: [vector],
    candidate: {
      object: {
        _id: id as Id<"objects">,
        identityStatus: "established",
        calibratorPenalty: 0,
        rejectionPenalty: 0,
      },
      artwork: {
        _id: `artwork-${id}` as Id<"artworks">,
        title: id,
        artist: "Fixture artist",
        rightsStatus: "public_domain",
      },
      placement: null,
      similarity: 0,
      keypointCount: pair.ref.count,
      inputSize: model.inputSize,
      ...encodeOrbFeatures(pair.ref),
    },
  };
}

it("recognizes a geometrically verified downloaded artwork", () => {
  const result = recognizeEntries(payload, rankEntries(vector, [entry("one")]));
  expect(result).toMatchObject({ outcome: "confident", best: { objectId: "one" } });
});

it("leaves conflicting artwork identities unresolved offline", () => {
  const firstChunk = rankEntries(vector, [entry("one")]);
  const candidates = rankEntries(vector, [entry("copy")], firstChunk);
  expect(recognizeEntries(payload, candidates)).toBeUndefined();
});

it("keeps multiple downloaded objects for the same artwork eligible", () => {
  const first = entry("one");
  const second = entry("another-object");
  second.candidate.artwork._id = first.candidate.artwork._id;
  const result = recognizeEntries(payload, rankEntries(vector, [first, second]));
  expect(result?.outcome).toBe("confident");
});

it("rejects incompatible capture models before attempting to decode features", () => {
  const stale = {
    modelVersion: "obsolete-model",
    descriptors: new ArrayBuffer(1),
    keypoints: new ArrayBuffer(1),
  };
  expect(recognizeEntries(stale, rankEntries(vector, [entry("one")]))).toBeUndefined();
});
