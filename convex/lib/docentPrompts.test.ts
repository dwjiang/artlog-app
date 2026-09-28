import { expect, it } from "vitest";

import { buildFactSheet, factSheetSchema } from "./docentPrompts";

const museum = {
  url: "https://museum.example/work",
  label: "Museum",
  score: 1,
  text: "Visible brushwork conveys wind.\nThe artist painted outdoors.",
};

it("keeps source passages and rejects invented details even when they cite a real source", () => {
  const facts = ["Visible brushwork conveys wind.", "The artist felt hopeful.", "The artist painted outdoors."].map(
    (text) => ({ text, source: "s1" }),
  );
  expect(buildFactSheet(facts, [museum])).toEqual([
    { id: "f1", text: facts[0].text, sourceUrl: museum.url, sourceLabel: "Museum", sourceScore: 1 },
    { id: "f2", text: facts[2].text, sourceUrl: museum.url, sourceLabel: "Museum", sourceScore: 1 },
  ]);
});

it("resolves sources by their position in the request and lets the grammar cite only those sent", () => {
  const wikidata = { url: "https://www.wikidata.org/wiki/Q1", label: "Wikidata", score: 0.8, text: "Inception: 1889" };
  expect(buildFactSheet([{ text: "Inception: 1889", source: " s2 " }], [museum, wikidata])).toEqual([
    { id: "f1", text: "Inception: 1889", sourceUrl: wikidata.url, sourceLabel: "Wikidata", sourceScore: 0.8 },
  ]);
  expect(buildFactSheet([{ text: "Inception: 1889", source: "s3" }], [museum, wikidata])).toEqual([]);
  expect(factSheetSchema(2).items.properties.source).toEqual({ type: "string", enum: ["s1", "s2"] });
});

it("allows typographic quote changes without accepting a changed claim", () => {
  const source = { ...museum, text: "He called it “a summer landscape.”" };
  const fact = { text: 'He called it "a summer landscape."', source: "s1" };
  expect(buildFactSheet([fact], [source])).toHaveLength(1);
  expect(buildFactSheet([{ ...fact, text: 'He called it "a winter landscape."' }], [source])).toHaveLength(0);
});
