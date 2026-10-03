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

it("accepts a caption copied without its punctuation or markdown", () => {
  const caption = { ...source, text: "Vincent van Gogh. _The Starry Night_. Saint Rémy, June 1889\nOil on canvas" };
  const review = {
    ...row,
    evidence: "Vincent van Gogh. The Starry Night\nSaint Rémy, June 1889",
    conflicts: [{ field: "date", text: "June, 1889" }],
  };
  expect(applyReferenceReview({ reviews: [review] }, [caption])).toEqual({
    sources: [caption],
    conflicts: [expect.objectContaining({ field: "date", text: "June, 1889" })],
  });
});

it.each([
  ["この星月夜の制作年は1889年です。", "星月夜", "date", "1889年"],
  ["这幅神奈川冲浪里由葛饰北斋创作。", "神奈川冲浪里", "artist", "葛饰北斋"],
  ["このひまわりの作者はフィンセントファンゴッホです。", "ひまわり", "artist", "フィンセントファンゴッホ"],
  ["この富士山の作者は𠮷田博です。", "富士山", "artist", "𠮷田博"],
])("accepts exact excerpts within unspaced prose: %s", (text, evidence, field, conflictText) => {
  const caption = { ...source, text };
  const conflict = { field, text: conflictText };
  expect(applyReferenceReview({ reviews: [{ ...row, evidence, conflicts: [conflict] }] }, [caption])).toEqual({
    sources: [caption],
    conflicts: [expect.objectContaining(conflict)],
  });
});

it.each([
  ["作者はFollower of Pieter Brueghel IIです。", "ollower of Pieter Brueghel II"],
  ["作者はFollower of Pieter Brueghel IIです。", "Follower of Pieter Brueg"],
  ["制作年は1889年です。", "889年"],
  ["この星月夜の制作年は1889年です。", "月星夜"],
])("rejects partial words, partial numbers and reordered characters in unspaced prose: %s", (text, evidence) => {
  expect(() => applyReferenceReview({ reviews: [{ ...row, evidence, conflicts: [] }] }, [{ ...source, text }])).toThrow(
    "Invalid reference review",
  );
});

it.each([
  { reviews: [] },
  { reviews: [row, row] },
  { reviews: [{ ...row, evidence: "invented" }] },
  { reviews: [{ ...row, evidence: "ollower of Pieter Brueg" }] },
  { reviews: [{ ...row, conflicts: [{ field: "artist", text: "invented" }] }] },
])("fails closed on missing, duplicate or ungrounded reviews", (value) => {
  expect(() => applyReferenceReview(value, [source])).toThrow("Invalid reference review");
});
