import {
  guideOpening,
  GUIDE_SECTIONS,
  guideResearch,
  guideSchema,
  parseGuideLines,
  unsupportedLines,
  validateGuide,
  validateGuideBody,
} from "./guide";
import { guideBodyFixture, guideFixture, openingFixture, researchFixture, sectionedGuide } from "./guide-fixtures";

const ids = new Set(researchFixture.map((fact) => fact.id));
const richIds = new Set([...ids, "f3", "f4", "f5", "f6", "f7", "f8"]);

it("preserves a substantial spoken guide and all its supporting citations", () => {
  expect(validateGuide(guideFixture, ids, openingFixture)).toEqual(guideFixture);
  expect(validateGuideBody(guideBodyFixture, ids)).toEqual(guideBodyFixture);
});

it("keeps each sentence's section, and rejects a script that lost them", () => {
  const script = guideBodyFixture.map(({ sentence, factIds }) => ({ sentence, fact_ids: factIds, support: sentence }));
  expect(parseGuideLines(sectionedGuide(script))?.map((line) => line.section)).toEqual(
    guideBodyFixture.map((line) => line.section),
  );
  const [opening, ...body] = guideFixture;
  const unsectioned = ({ sentence, factIds }: (typeof guideFixture)[number]) => ({ sentence, factIds });
  expect(validateGuide([unsectioned(opening), ...body], ids, openingFixture)).toBeNull();
  expect(validateGuide([opening, unsectioned(body[0]), ...body.slice(1)], ids, openingFixture)).toBeNull();
  expect(validateGuide([opening, { ...body[0], section: "coda" }, ...body.slice(1)], ids, openingFixture)).toBeNull();
});

it("opens like a label with the year or whole range, never a catalogue date string or a year the title carries", () => {
  expect(guideOpening({ title: "Water Lilies", artist: "Claude Monet", date: "1916" })).toBe(openingFixture);
  expect(
    guideOpening({
      title: " Study\n of a Young Woman ",
      artist: "Johannes Vermeer",
      date: " ca. 1665–67 ",
    }),
  ).toBe("Johannes Vermeer. Study of a Young Woman. Circa 1665 to 1667.");
  expect(
    guideOpening({
      title: "A Sunday on La Grande Jatte — 1884",
      artist: "Georges Seurat",
      date: "1884–86, border added 1888–89",
    }),
  ).toBe("Georges Seurat. A Sunday on La Grande Jatte — 1884. Dated 1884 to 1886.");
  expect(guideOpening({ title: "Paris, 1918", artist: "Unknown maker", date: "1918" })).toBe(
    "Unknown maker. Paris, 1918.",
  );
  expect(guideOpening({ title: "Where Do We Come From?", artist: "Paul Gauguin", date: "1897" })).toBe(
    "Paul Gauguin. Where Do We Come From? Dated 1897.",
  );
  for (const [date, spoken] of [
    ["About 1916–19", "Circa 1916 to 1919."],
    ["1916–1919, reworked 1920", "Dated 1916 to 1919."],
    ["1898–03", "Dated 1898 to 1903."],
    ["1916-1916", "Dated 1916."],
    ["c. 1490–c. 1500", "Circa 1490 to 1500."],
    ["1490–ca. 1500", "Circa 1490 to 1500."],
  ]) {
    expect(guideOpening({ title: "Water Lilies", artist: "Claude Monet", date })).toBe(
      `Claude Monet. Water Lilies. ${spoken}`,
    );
  }
  for (const date of [undefined, "", "  ", "late Edo period"]) {
    expect(guideOpening({ title: "Water Lilies", artist: "Claude Monet", date })).toBe("Claude Monet. Water Lilies.");
  }
});

it("leaves out a date that would be misstated: a decade, an era, BCE, before or after, or a slash that may mean either year", () => {
  for (const date of [
    "1850s",
    "Late 1770s",
    "After 1571",
    "before 1520",
    "probably 1650",
    "ca. 2600–2500 B.C.",
    "2500 BCE",
    "Qing dynasty (1644–1911); late 17th century",
    "modeled 1880, cast 1901",
    "1750/75",
    "1927/28",
  ]) {
    expect(guideOpening({ title: "Vase", artist: "Unknown maker", date })).toBe("Unknown maker. Vase.");
  }
});

it("requires the exact metadata opening first and allows only that line to be uncited", () => {
  for (const value of [
    guideBodyFixture,
    [...guideBodyFixture, guideFixture[0]],
    [{ sentence: "This is another painting.", factIds: [] }, ...guideBodyFixture],
    [{ ...guideFixture[0], factIds: ["f1"] }, ...guideBodyFixture],
  ]) {
    expect(validateGuide(value, ids, openingFixture)).toBeNull();
  }
});

it("rejects tiny, uncited, invented, repeated and oversized guides", () => {
  for (const value of [
    null,
    [],
    guideFixture.slice(0, 1),
    guideFixture.map((line) => ({ ...line, factIds: [] })),
    guideFixture.map((line) => ({ ...line, factIds: ["invented"] })),
    [...guideFixture, guideFixture[0]],
    [...guideFixture, { sentence: "word ".repeat(30), factIds: ["f1"] }],
  ]) {
    expect(validateGuide(value, ids, openingFixture)).toBeNull();
  }
});

it("rejects a script whose sentence carries leaked JSON or markup, or was cut off", () => {
  for (const leak of [
    "She is a real person.', 'fact_ids': ['f4']}, {'sentence':",
    "Look at the <emphasis>lilies</emphasis> on the pond.",
    "The garden [f1] appears twice.",
    "Cassatt said she wanted to draw out the",
    "Notice the lilies on the pond, and the reflections around them",
  ]) {
    expect(validateGuideBody([...guideBodyFixture.slice(0, 9), { sentence: leak, factIds: ["f1"] }], ids)).toBeNull();
  }
});

it("accepts a sentence only when its support span is copied verbatim from a cited fact", () => {
  const lines = parseGuideLines({
    hook: [
      {
        sentence: "Start with the lilies resting on the surface of the pond.",
        fact_ids: ["f1"],
        support: "water lilies and reflections of the garden",
      },
    ],
    look: [
      {
        sentence: "Look closely at the visible strokes of oil paint.",
        fact_ids: ["f2"],
        support: "“using visible strokes  of oil paint”",
      },
      {
        sentence: "The lilies float serenely in the evening light.",
        fact_ids: ["f1"],
        support: "lilies float serenely",
      },
    ],
    story: [
      {
        sentence: "The artist returned to this garden repeatedly.",
        fact_ids: ["f1"],
        support: "painted the garden repeatedly",
      },
    ],
    takeaway: [{ sentence: "Notice the pond.", fact_ids: ["f1"], support: "pond" }],
  })!;
  expect(lines.map((line) => line.sentence)).toEqual([
    "Start with the lilies resting on the surface of the pond.",
    "Look closely at the visible strokes of oil paint.",
    "The lilies float serenely in the evening light.",
    "The artist returned to this garden repeatedly.",
    "Notice the pond.",
  ]);
  expect(unsupportedLines(lines, researchFixture).map((line) => line.sentence)).toEqual([
    "The lilies float serenely in the evening light.",
    "The artist returned to this garden repeatedly.",
    "Notice the pond.",
  ]);
});

it("accepts a span verbatim whole or clause by clause, whatever the case, and rejects an invented clause", () => {
  const line = (support: string, fact_ids = ["f1", "f2"]) => ({
    sentence: "Look at the pond.",
    fact_ids,
    support,
    section: "look" as const,
  });
  expect(
    unsupportedLines(
      [
        line("water lilies and reflections ... without a horizon"),
        line("The painting shows water lilies. The artist painted the garden repeatedly."),
        line("Water lilies, without a horizon, visible strokes of oil paint"),
        line("REFLECTIONS OF THE GARDEN"),
        line("pond, without"),
      ],
      researchFixture,
    ),
  ).toEqual([]);
  expect(
    unsupportedLines(
      [
        line("water lilies and reflections, in the evening light"),
        line("water lilies and reflections", ["f2"]),
        line("pond, oil, lily"),
      ],
      researchFixture,
    ),
  ).toHaveLength(3);
});

it("reads the script only as hook, look, story and takeaway sections of cited sentences", () => {
  const line = { sentence: "Start with the lilies on the pond.", fact_ids: ["f1"], support: "water lilies" };
  const sections = { hook: [line], look: [], story: [], takeaway: [] };
  expect(parseGuideLines(sections)).toHaveLength(1);
  expect(parseGuideLines({ thread: "One pond, seen again", quote: null, ...sections })).toHaveLength(1);
  for (const value of [
    [line],
    { ...sections, story: undefined },
    { ...sections, hook: [{ sentence: "No span here.", fact_ids: ["f1"] }] },
    { ...sections, hook: [{ ...line, fact_ids: [1] }] },
  ]) {
    expect(parseGuideLines(value)).toBeNull();
  }
});

it("gives the guide only prose research, never catalogue lines", () => {
  const catalogue = [
    "Material: oil paint, canvas",
    "Location: Metropolitan Museum of Art",
    "Inception: 1665",
    "Credit Line: Gift of a donor, 1990",
    "Provenance: The artist; sold to the museum, 1930.",
    "Inventory number: 1993.132",
    " Movement : Impressionism",
  ];
  const prose = [
    "JUDITH BARTER: Well, he was riding around in the country one day.",
    "Material studies show the artist mixed sand into the paint.",
  ];
  const facts = [...catalogue, ...prose].map((text, index) => ({
    ...researchFixture[0],
    id: `f${index + 1}`,
    text,
  }));
  expect(guideResearch(facts).map((fact) => fact.text)).toEqual(prose);
});

it("accepts a guide only inside the 100 to 225 word band, or from 90 words when research is thin", () => {
  const extra = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      sentence: `Extra sentence ${index + 1} about the lilies resting on the pond and the reflections of the garden around them.`,
      factIds: ["f1"],
      section: "story" as const,
    }));
  // The first five fixture sentences run 85 words; the short line brings them to 92.
  const short = { sentence: "One more lily rests near the edge.", factIds: ["f1"], section: "takeaway" as const };
  expect(validateGuideBody(guideBodyFixture.slice(0, 6), richIds)).toHaveLength(6);
  expect(validateGuideBody(guideBodyFixture.slice(0, 5), richIds)).toBeNull();
  expect(validateGuideBody([...guideBodyFixture.slice(0, 5), short], richIds)).toBeNull();
  expect(validateGuideBody([...guideBodyFixture.slice(0, 5), short], ids)).toHaveLength(6);
  expect(validateGuideBody(guideBodyFixture.slice(0, 5), ids)).toBeNull();
  expect(validateGuideBody([...guideBodyFixture, ...extra(2)], richIds)).toHaveLength(12);
  expect(validateGuideBody([...guideBodyFixture, ...extra(3)], richIds)).toBeNull();
});

it("asks for the thread and quote first, then short hook, look, story and takeaway sentences", () => {
  const full = guideSchema(richIds.size);
  const thin = guideSchema(ids.size);
  expect(Object.keys(full.properties)).toEqual(["thread", "quote", "hook", "look", "story", "takeaway"]);
  expect(full.required).toEqual(["thread", "quote", "hook", "look", "story", "takeaway"]);
  expect(full.properties.story.minItems).toBe(6);
  expect(thin.properties.story.minItems).toBe(5);
  const relaxed = guideSchema(richIds.size, { relaxed: true });
  expect(GUIDE_SECTIONS.map((section) => relaxed.properties[section].minItems)).toEqual([1, 1, 1, 1]);
  expect(relaxed.properties.story.maxItems).toBe(full.properties.story.maxItems);
  expect(full.properties.look.items.properties.sentence.maxLength).toBe(140);
  expect(full.properties.hook.items.properties.sentence.maxLength).toBe(170);
});
