import { expect, it } from "vitest";

import { buildFactSheet, factSheetSchema, factsPerSource, parseFactSheet } from "./docentPrompts";

const museum = {
  url: "https://museum.example/work",
  label: "Museum",
  score: 1,
  text: "Visible brushwork conveys wind.\nThe artist painted outdoors.",
};

it("keeps source passages and rejects invented details even when they cite a real source", () => {
  const facts = ["Visible brushwork conveys wind.", "The artist felt hopeful.", "The artist painted outdoors."];
  expect(buildFactSheet([facts], [museum])).toEqual([
    { id: "f1", text: facts[0], sourceUrl: museum.url, sourceLabel: "Museum", sourceScore: 1 },
    { id: "f2", text: facts[2], sourceUrl: museum.url, sourceLabel: "Museum", sourceScore: 1 },
  ]);
});

it("checks each fact against the source it was copied from and lists better-scored sources first", () => {
  const wikidata = { url: "https://www.wikidata.org/wiki/Q1", label: "Wikidata", score: 0.8, text: "Inception: 1889" };
  expect(buildFactSheet([["Visible brushwork conveys wind."], []], [wikidata, museum])).toEqual([]);
  expect(buildFactSheet([["Inception: 1889"], ["Visible brushwork conveys wind."]], [wikidata, museum])).toEqual([
    { id: "f1", text: "Visible brushwork conveys wind.", sourceUrl: museum.url, sourceLabel: "Museum", sourceScore: 1 },
    { id: "f2", text: "Inception: 1889", sourceUrl: wikidata.url, sourceLabel: "Wikidata", sourceScore: 0.8 },
  ]);
});

it("allows typographic quote changes without accepting a changed claim", () => {
  const source = { ...museum, text: "He called it “a summer landscape.”" };
  expect(buildFactSheet([['He called it "a summer landscape."']], [source])).toHaveLength(1);
  expect(buildFactSheet([['He called it "a winter landscape."']], [source])).toHaveLength(0);
});

it("caps each source's facts, allowing more when few prose sources share the sheet", () => {
  const page = (host: string) => ({ url: `https://${host}/work` });
  expect(factsPerSource([page("museum.example")])).toBe(20);
  expect(factsPerSource([page("museum.example"), page("www.wikidata.org")])).toBe(20);
  expect(factsPerSource([page("museum.example"), page("en.wikipedia.org")])).toBe(10);
  expect(factsPerSource(["a", "b", "c", "d"].map((host) => page(`${host}.example`)))).toBe(8);
  expect(factSheetSchema(8)).toMatchObject({ type: "array", minItems: 1, maxItems: 8 });
});

it("reads the model's facts as texts and rejects any other shape", () => {
  expect(parseFactSheet([{ text: "One." }, { text: "Two." }])).toEqual(["One.", "Two."]);
  expect(parseFactSheet([{ text: 1 }])).toBeNull();
  expect(parseFactSheet({ s1: [] })).toBeNull();
});
