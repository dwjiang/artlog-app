import { expect, it } from "vitest";
import { buildFactSheet } from "./docentPrompts";

it("keeps source passages and rejects invented details even when their citation URL is valid", () => {
  const sources = [
    {
      url: "https://museum.example/work",
      label: "Museum",
      score: 1,
      text: "Visible brushwork conveys wind.\nThe artist painted outdoors.",
    },
  ];
  const facts = [
    "Visible brushwork conveys wind.",
    "The artist felt hopeful.",
    "The artist painted outdoors.",
  ].map((text, index) => ({
    id: `f${index}`,
    text,
    sourceUrl: sources[0].url,
    sourceLabel: "Made up",
    sourceScore: 0.1,
  }));
  expect(buildFactSheet(facts, sources)).toEqual([
    {
      id: "f1",
      text: facts[0].text,
      sourceUrl: sources[0].url,
      sourceLabel: "Museum",
      sourceScore: 1,
    },
    {
      id: "f2",
      text: facts[2].text,
      sourceUrl: sources[0].url,
      sourceLabel: "Museum",
      sourceScore: 1,
    },
  ]);
});

it("allows typographic quote changes without accepting a changed claim", () => {
  const source = {
    url: "https://museum.example/work",
    label: "Museum",
    score: 1,
    text: "He called it “a summer landscape.”",
  };
  const fact = {
    id: "f1",
    text: 'He called it "a summer landscape."',
    sourceUrl: source.url,
    sourceLabel: source.label,
    sourceScore: 1,
  };
  expect(buildFactSheet([fact], [source])).toHaveLength(1);
  expect(
    buildFactSheet([{ ...fact, text: 'He called it "a winter landscape."' }], [source]),
  ).toHaveLength(0);
});
