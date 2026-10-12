import { expect, it } from "vitest";

import {
  buildFactSheet,
  docentSchema,
  factSheetSchema,
  factsPerSource,
  parseFactSheet,
  writtenInEnglish,
} from "./docentPrompts";

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

it("keeps a copy that differs from its source only by accents or a fixed typo, in the source's words", () => {
  const source = {
    ...museum,
    text: "In this depiction of his sister, Julie Fréderique Lemmen, the artist captured her biting personality. The painter may have chosen these scenes fo their felicitous overtones.",
  };
  const accent =
    "In this depiction of his sister, Julie Frédérique Lemmen, the artist captured her biting personality.";
  const typo = "The painter may have chosen these scenes for their felicitous overtones.";
  expect(buildFactSheet([[accent, typo]], [source]).map(({ text }) => text)).toEqual([
    accent,
    "The painter may have chosen these scenes fo their felicitous overtones.",
  ]);
  // A changed number or a second change is a different claim, not a typo.
  expect(buildFactSheet([["The painter may have chosen 12 scenes for their felicitous overtones."]], [source])).toEqual(
    [],
  );
  expect(buildFactSheet([["The painter may have chosen those scenes for their joyful overtones."]], [source])).toEqual(
    [],
  );
});

it("ranks prose ahead of catalogue lines and captions for the sheet's places", () => {
  const wikidata = { url: "https://www.wikidata.org/wiki/Q1", label: "Wikidata", score: 0.8, text: "Inception: 1889" };
  const article = {
    url: "https://en.wikipedia.org/wiki/Work",
    label: "Wikipedia",
    score: 0.7,
    text: "The cypresses were painted in thick strokes during his stay at the asylum.",
  };
  const sheet = buildFactSheet([["Inception: 1889"], [article.text]], [wikidata, article]);
  expect(sheet.map(({ text }) => text)).toEqual([article.text, "Inception: 1889"]);
});

it("asks for English prose citing only the sheet's facts, and recognises prose copied in another language", () => {
  const schema = docentSchema(["f1", "f2"]);
  expect(schema.items.properties.fact_ids).toEqual({
    type: "array",
    minItems: 1,
    items: { type: "string", enum: ["f1", "f2"] },
  });
  expect(writtenInEnglish("Josefa de Óbidos painted this around 1670, and it hangs in the museum in Lisbon.")).toBe(
    true,
  );
  expect(
    writtenInEnglish(
      "San Giuseppe col Bambino è un dipinto della pittrice Josefa de Óbidos realizzato all'incirca nel 1670 e conservato nel Museo.",
    ),
  ).toBe(false);
  // Accented function words count as well: "è", "était", "är", "på".
  expect(writtenInEnglish("Il quadro è bello, Monet était là, tavlan är på museet.")).toBe(false);
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
