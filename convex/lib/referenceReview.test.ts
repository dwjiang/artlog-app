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
    incomplete: false,
    diagnostics: expect.any(Object),
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
    incomplete: false,
    diagnostics: expect.any(Object),
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
    incomplete: false,
    diagnostics: expect.any(Object),
  });
});

it.each([
  ["作者はFollower of Pieter Brueghel IIです。", "ollower of Pieter Brueghel II"],
  ["作者はFollower of Pieter Brueghel IIです。", "Follower of Pieter Brueg"],
  ["制作年は1889年です。", "889年"],
  ["この星月夜の制作年は1889年です。", "月星夜"],
])("leaves out a reference quoted with partial words, numbers or reordered characters: %s", (text, evidence) => {
  expect(applyReferenceReview({ reviews: [{ ...row, evidence, conflicts: [] }] }, [{ ...source, text }])).toEqual({
    sources: [],
    conflicts: [],
    incomplete: true,
    diagnostics: expect.any(Object),
  });
});

it.each([
  null,
  { reviews: [] },
  { reviews: [{ ...row, evidence: "invented" }] },
  { reviews: [{ ...row, evidence: "ollower of Pieter Brueg" }] },
  { reviews: [{ ...row, conflicts: [{ field: "artist", text: "invented" }] }] },
  { reviews: [{ ...row, conflicts: [{ field: "title", text: "Follower of Pieter Brueghel II." }] }] },
])("leaves out a reference whose review is missing or ungrounded, without failing the research", (value) => {
  expect(applyReferenceReview(value, [source])).toEqual({
    sources: [],
    conflicts: [],
    incomplete: true,
    diagnostics: expect.any(Object),
  });
});

it("reads each row on its own: a repeated or broken row costs only its reference", () => {
  const second = { ...source, url: "https://auction.example/2", text: "Another lot. Oil on panel, 26.8 cm." };
  const rows = [
    { ...row, conflicts: [] },
    { ...row, conflicts: [] },
    { source: "s2", relation: "same_artwork", evidence: "invented", comparison: "", conflicts: [] },
  ];
  expect(applyReferenceReview({ reviews: rows }, [source, second])).toEqual({
    sources: [source],
    conflicts: [],
    incomplete: true,
    diagnostics: expect.any(Object),
  });
});

it("never drops the museum's own page, but still flags its attribution", () => {
  const owner = { ...source, url: "https://museum.example/work", firstParty: true };
  expect(
    applyReferenceReview({ reviews: [{ ...row, relation: "uncertain", conflicts: [] }] }, [owner]).sources,
  ).toEqual([owner]);
  expect(applyReferenceReview({ reviews: [row] }, [owner]).conflicts).toHaveLength(1);
});

it.each([
  ["date", "Dated 1840", { artist: "Baijnath", yearStart: 1840, yearEnd: 1840 }],
  ["date", "ca. 1700–1710", { artist: "Unknown artist", yearStart: 1705, yearEnd: 1705 }],
  ["date", "c. 1695", { artist: "Unknown artist", yearStart: 1700, yearEnd: 1700 }],
  ["date", "18th century", { artist: "Unknown artist", date: "1765" }],
  ["date", "1898–03", { artist: "Unknown artist", yearStart: 1900, yearEnd: 1900 }],
  ["date", "1698–02", { artist: "Unknown artist", date: "1701" }],
  ["date", "1900", { artist: "Unknown artist", date: "1898–03" }],
  ["artist", "Unknown", { artist: "Baijnath" }],
  ["artist", "Anonymous", { artist: "Baijnath" }],
  ["artist", "Vincent van Gogh (1853–1890)", { artist: "Vincent van Gogh" }],
])("drops a %s conflict that agrees with the work: %s", (field, text, target) => {
  const page = { ...source, text: `Object record. ${text}. Oil on panel.` };
  const review = { ...row, evidence: "Object record", conflicts: [{ field, text }] };
  expect(applyReferenceReview({ reviews: [review] }, [page], target)).toEqual({
    sources: [page],
    conflicts: [],
    incomplete: false,
    diagnostics: expect.any(Object),
  });
});

it.each([
  ["date", "1916", { artist: "Pierre Bonnard", yearStart: 1939, yearEnd: 1939 }],
  ["date", "1898–03", { artist: "Unknown artist", yearStart: 1820, yearEnd: 1820 }],
  ["date", "1698–02", { artist: "Unknown artist", date: "1620" }],
  ["date", "Edo period", { artist: "Unknown artist", yearStart: 1700, yearEnd: 1700 }],
  ["artist", "Follower of Pieter Brueghel II", { artist: "Pieter Brueghel II" }],
])("keeps a %s conflict that disagrees or cannot be judged: %s", (field, text, target) => {
  const page = { ...source, text: `Object record. ${text}. Oil on panel.` };
  const review = { ...row, evidence: "Object record", conflicts: [{ field, text }] };
  expect(applyReferenceReview({ reviews: [review] }, [page], target).conflicts).toHaveLength(1);
});

it.each([
  [{ reviews: [] }, { missingReviewCount: 1 }],
  [{ reviews: [{ ...row, evidence: "private-invented-evidence" }] }, { ungroundedEvidenceCount: 1 }],
  [
    { reviews: [{ ...row, conflicts: [{ field: "date", text: "private-invented-conflict" }] }] },
    { invalidConflictCount: 1 },
  ],
  [{ reviews: [{ ...row, relation: "invalid-private-relation" }] }, { invalidReviewCount: 1 }],
])("summarizes rejection categories without copying model or source content", (value, counts) => {
  const result = applyReferenceReview(value, [source]);
  expect(result).toMatchObject({
    incomplete: true,
    diagnostics: { referenceCount: 1, reviewCount: value.reviews.length, ...counts },
  });
  const diagnostics = JSON.stringify((result as unknown as { diagnostics: unknown }).diagnostics);
  for (const secret of [source.url, source.text, source.referenceUrl, "private-invented"]) {
    expect(diagnostics).not.toContain(secret);
  }
});
