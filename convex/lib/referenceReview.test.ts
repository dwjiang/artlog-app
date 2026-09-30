import { expect, it } from "vitest";

import { applyReferenceReview } from "./referenceReview";

const source = {
  url: "https://auction.example/1",
  referenceUrl: "https://commons.wikimedia.org/wiki/File:A.jpg",
  label: "Auction",
  score: 0.8,
  text: "The Battle between Carnival and Lent. Follower of Pieter Brueghel II. Oil on circular panel, 26.8 cm.",
};
const row = {
  source: "s1",
  comparison: "The citation and object details match the target.",
  relation: "same_artwork",
  evidence: source.text,
  conflicts: [{ field: "artist", text: "Follower of Pieter Brueghel II." }],
};

it("retains attribution conflict evidence with its citation trail", () => {
  expect(applyReferenceReview({ reviews: [row] }, [source]).conflicts).toEqual([
    {
      field: "artist",
      text: "Follower of Pieter Brueghel II.",
      sourceUrl: source.url,
      sourceLabel: source.label,
      referenceUrl: source.referenceUrl,
    },
  ]);
});

it.each(["other", "uncertain"])("excludes %s artwork pages", (relation) => {
  expect(applyReferenceReview({ reviews: [{ ...row, relation, conflicts: [] }] }, [source])).toEqual({
    sources: [],
    conflicts: [],
  });
});

it.each([
  { reviews: [] },
  { reviews: [row, row] },
  { reviews: [{ ...row, evidence: "invented" }] },
  { reviews: [{ ...row, conflicts: [{ field: "artist", text: "invented" }] }] },
])("fails closed on missing, duplicate or ungrounded reviews", (value) => {
  expect(() => applyReferenceReview(value, [source])).toThrow("Invalid reference review");
});
