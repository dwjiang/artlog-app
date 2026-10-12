import {
  citeQuotedFacts,
  fitWordCap,
  guideBodyProblems,
  guideOpening,
  GUIDE_SECTIONS,
  guideResearch,
  guideSchema,
  guideShape,
  guideWordFloor,
  narratable,
  normalizePassage,
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

it("lets a span skip a catalogue aside in parentheses or between dashes, but not change the words around it", () => {
  const facts = [
    {
      id: "f1",
      text: "After a trip to Venice in late 1908 (see cat. 45)—one that allowed him to look at his paintings with 'a clearer eye'—Monet was ready.",
    },
  ];
  const line = (support: string) => ({
    sentence: "He went to Venice.",
    fact_ids: ["f1"],
    support,
    section: "story" as const,
  });
  expect(
    unsupportedLines(
      [
        line("After a trip to Venice in late 1908—one that allowed him to look at his paintings with 'a clearer eye'"),
        line("After a trip to Venice in late 1908—Monet was ready."),
        line("After a trip to Venice in late 1908 one that allowed him to look at his paintings with 'a clearer eye'"),
        line(
          "After a trip to Venice in late 1908 -- one that allowed him to look at his paintings with 'a clearer eye' -- Monet",
        ),
      ],
      facts,
    ),
  ).toEqual([]);
  expect(
    unsupportedLines(
      [
        line("After a trip to Rome in late 1908—Monet was ready."),
        line("After a trip to Venice in 1908 one that allowed him"),
      ],
      facts,
    ),
  ).toHaveLength(2);
});

it("drops only a cross-reference without a mark where it was cut", () => {
  const facts = [{ id: "f1", text: "The painting was (wrongly) attributed to Monet (figs. 3–4) in 1910." }];
  const line = (support: string) => ({
    sentence: "It was attributed to Monet.",
    fact_ids: ["f1"],
    support,
    section: "story" as const,
  });
  expect(unsupportedLines([line("The painting was (wrongly) attributed to Monet in 1910.")], facts)).toEqual([]);
  expect(unsupportedLines([line("The painting was attributed to Monet in 1910.")], facts)).toHaveLength(1);
});

it("matches a span that drops accents, and ignores a stray mark but not a stray number", () => {
  const facts = [
    { id: "f1", text: "He made them for his murals at the Musée de l’Orangerie in Paris between 1914 and 1926." },
  ];
  const line = (support: string) => ({
    sentence: "They led to his murals in Paris.",
    fact_ids: ["f1"],
    support,
    section: "story" as const,
  });
  expect(unsupportedLines([line("his murals at the Musee de l'Orangerie in Paris. /")], facts)).toEqual([]);
  expect(unsupportedLines([line("his murals at the Musee de l'Orangerie in Paris. 2")], facts)).toHaveLength(1);
});

it.each(["(not)", "—not—", "–not–"])("rejects an invented short negation inside %s", (negation) => {
  const facts = [{ id: "f1", text: "The canvas was painted by Monet." }];
  const line = {
    sentence: "It was not painted by Monet.",
    fact_ids: ["f1"],
    support: `The canvas was ${negation} painted by Monet.`,
    section: "story" as const,
  };
  expect(unsupportedLines([line], facts)).toEqual([line]);
});

it.each(["notable", "cannot", "noté"])("does not ground an invented negation inside %s", (word) => {
  const facts = [{ id: "f1", text: `The canvas was painted by Monet. The catalogue uses the word “${word}”.` }];
  const lines = ["(not)", "—not—", "–not–"].map((negation) => ({
    sentence: "It was not painted by Monet.",
    fact_ids: ["f1"],
    support: `The canvas was ${negation} painted by Monet.`,
    section: "story" as const,
  }));
  expect(unsupportedLines(lines, facts)).toEqual(lines);
});

it("matches a span that starts or ends inside an elided word, but not one with a changed word", () => {
  const facts = [
    {
      id: "f1",
      text: "Il est attesté qu'en 1344, le polyptyque était déjà placé sur l'autel principal de la cathédrale de Florence.",
    },
    { id: "f2", text: "The polyptych was restored in 1994." },
  ];
  const line = (support: string, factIds = ["f1"]) => ({
    sentence: "By 1344 it stood on the high altar of Florence Cathedral.",
    fact_ids: factIds,
    support,
    section: "story" as const,
  });
  const verbatim = "en 1344, le polyptyque était déjà placé sur l'autel principal de la cathédrale de Florence";
  expect(unsupportedLines([line(verbatim)], facts)).toEqual([]);
  expect(
    unsupportedLines([line("Il est attesté qu’en 1344, le polyptyque était déjà placé sur l’autel")], facts),
  ).toEqual([]);
  expect(unsupportedLines([line("autel principal de la cathédrale de Florence")], facts)).toEqual([]);
  expect(unsupportedLines([line(verbatim.replace("1344", "1345"))], facts)).toHaveLength(1);
  expect(citeQuotedFacts([line(verbatim, ["f2"])], facts)[0].fact_ids).toEqual(["f2", "f1"]);
});

it("reads a copy the same whatever its typography: accents, folded letters, dashes, hyphens and quote marks", () => {
  expect(normalizePassage("Musée de l’Orangerie")).toBe(normalizePassage("Musee de l'Orangerie"));
  expect(normalizePassage("Hammershøi’s Straße, Læsø, Łódź, 73 × 93 cm")).toBe(
    "hammershois strasse, laeso, lodz, 73 x 93 cm",
  );
  expect(normalizePassage("in 1888–89, near‑abstract")).toBe(normalizePassage("in 1888-89, near-abstract"));
  expect(normalizePassage("«Monet´s» „garden“ ‹pond› sea­scape")).toBe("monets garden pond seascape");
});

it("matches the dash, hyphen and cross-reference styles a copy may use, but never part of a word", () => {
  const line = (support: string, text: string) =>
    unsupportedLines([{ sentence: "He went.", fact_ids: ["f1"], support, section: "story" }], [{ id: "f1", text }]);
  expect(line("He worked on it in 1888-89 at Arles", "He worked on it in 1888–89 at Arles.")).toEqual([]);
  expect(line("He worked on it in 1888–99 at Arles", "He worked on it in 1888-89 at Arles.")).toHaveLength(1);
  const venice = "After a trip to Venice in late 1908—one that allowed him to look at his paintings";
  expect(line("After a trip to Venice in late 1908 - one that allowed him to look", venice)).toEqual([]);
  for (const reference of ["(cat. no. 45)", "(see fig. 3 and cat. 45)", "(figure 3)", "[cat. 45]", "(pl. IV)", "[3]"]) {
    const text = `The series ${reference} was begun in 1903 at Giverny.`;
    expect(line("The series was begun in 1903 at Giverny", text)).toEqual([]);
  }
  expect(line("calls the canvas not", "The critic calls the canvas notable for its color.")).toHaveLength(1);
});

it("cites the facts a joined span quotes, but leaves an invented clause unsupported", () => {
  const facts = [
    { id: "f1", text: "I have destroyed some . . . Some I recommence." },
    { id: "f2", text: "These struggles had already forced Monet to twice postpone exhibiting this series of works." },
  ];
  const joined = {
    sentence: "He destroyed canvases and twice delayed the show.",
    fact_ids: ["f2"],
    support: "I have destroyed some . . . These struggles had already forced Monet to twice postpone exhibiting",
    section: "story" as const,
  };
  const [cited] = citeQuotedFacts([joined], facts);
  expect(cited.fact_ids).toEqual(["f2", "f1"]);
  expect(unsupportedLines([cited], facts)).toEqual([]);
  const invented = { ...joined, support: "I have destroyed some. He burned them all in the garden." };
  expect(citeQuotedFacts([invented], facts)).toEqual([invented]);
});

it.each([
  ["この作品では画家は庭の池に浮かぶ睡蓮と水面の反射を描いています。", "庭の池に浮かぶ睡蓮と水面の反射"],
  ["这幅画描绘了花园池塘中的睡莲和水面上的倒影。", "花园池塘中的睡莲和水面上的倒影"],
  ["この作品はフィンセントファンゴッホが描いた絵画です。", "フィンセントファンゴッホ"],
  ["この作品は𠮷田博が庭の池を描いた絵画です。", "𠮷田博が庭の池を描いた"],
  ["制作年は1889年で、作者はVincent van Goghです。", "1889年で、作者はVincent van Gogh"],
])("grounds exact excerpts within unspaced prose and repairs their citations: %s", (text, support) => {
  const facts = [
    { id: "f1", text },
    { id: "f2", text: "A separate passage." },
  ];
  const line = { sentence: "Look at the painting.", fact_ids: ["f1"], support, section: "look" as const };
  expect(unsupportedLines([line], facts)).toEqual([]);
  const [repaired] = citeQuotedFacts([{ ...line, fact_ids: ["f2"] }], facts);
  expect(repaired.fact_ids).toEqual(["f2", "f1"]);
  expect(unsupportedLines([repaired], facts)).toEqual([]);
});

it.each([
  ["作者はVincent van Goghです。", "incent van Gogh"],
  ["作者はVincent van Goghです。", "Vincent van Gog"],
  ["制作年は1889年で画家は庭の池を描いています。", "889年で画家は庭の池を描いています"],
  ["この作品では画家は庭の池に浮かぶ睡蓮を描いています。", "庭の池に浮かぶ蓮睡"],
])("rejects partial Latin words, numbers and reordered characters in unspaced prose: %s", (text, support) => {
  const facts = [{ id: "f1", text }];
  const line = { sentence: "Look at the painting.", fact_ids: ["f1"], support, section: "look" as const };
  expect(unsupportedLines([line], facts)).toEqual([line]);
  const uncited = { ...line, fact_ids: [] };
  expect(citeQuotedFacts([uncited], facts)).toEqual([uncited]);
});

it("narrates only research with two prose facts and twenty-five words of them", () => {
  const fact = (text: string) => ({ text });
  expect(narratable([fact("Seascene with boat listing amidst wild waves, 3 figures on the deck.")])).toBe(false);
  expect(
    narratable([
      fact("It was made in England, Great Britain in 1911."),
      fact("Seascene with boat listing amidst wild waves, 3 figures on the deck, a broken mast and damaged sail."),
    ]),
  ).toBe(true);
  expect(narratable([fact("A short caption of six words."), fact("Another short caption of six words.")])).toBe(false);
});

it("never speaks a Wikidata id as a title or artist", () => {
  expect(guideOpening({ title: "Q103036181", artist: "Thomas Fearnley", date: "1833" })).toBe(
    "Thomas Fearnley. Dated 1833.",
  );
  expect(guideOpening({ title: "Leeds Woods", artist: "Q704868", date: "1888" })).toBe("Leeds Woods. Dated 1888.");
});

it("retains supported short fragments and ignores empty fragments", () => {
  const facts = [{ id: "f1", text: "The canvas was not painted by Monet." }];
  const line = {
    sentence: "It was not painted by Monet.",
    fact_ids: ["f1"],
    support: "The canvas was (not)—painted by Monet.",
    section: "story" as const,
  };
  expect(unsupportedLines([line], facts)).toEqual([]);
});

it.each(["–", "—", " – ", " — "])("checks both ends of a numeric range separated by %s", (dash) => {
  const passage = `The artist worked on the painting in 1888${dash}89`;
  const detail = "using visible strokes of oil paint";
  const facts = [{ id: "f1", text: `${passage} (see cat. 45)—${detail}.` }];
  const line = (support: string) => ({
    sentence: "He worked on it from 1888 to 1889.",
    fact_ids: ["f1"],
    support,
    section: "story" as const,
  });
  expect(unsupportedLines([line(`${passage}—${detail}`)], facts)).toEqual([]);
  expect(unsupportedLines([line(`${passage.replace("89", "99")}—${detail}`)], facts)).toHaveLength(1);
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

it("closes a sentence the writer left without a full stop", () => {
  const lines = parseGuideLines({
    hook: [{ sentence: "Look at the lilies on the pond ", fact_ids: ["f1"], support: "water lilies" }],
    look: [{ sentence: "Do you see the garden?", fact_ids: ["f1"], support: "water lilies" }],
    story: [{ sentence: "He called it “a pond.”", fact_ids: ["f1"], support: "water lilies" }],
    takeaway: [],
  });
  expect(lines?.map((line) => line.sentence)).toEqual([
    "Look at the lilies on the pond.",
    "Do you see the garden?",
    "He called it “a pond.”",
  ]);
});

it.each(["", "        ", "\t \n\r"])("rejects a guide containing a blank sentence: %j", (sentence) => {
  const script = guideBodyFixture.map((line, index) => ({
    sentence: index === 1 ? sentence : line.sentence,
    fact_ids: line.factIds,
    support: "water lilies",
  }));
  const lines = parseGuideLines(sectionedGuide(script))!;
  const body = lines.map(({ sentence, fact_ids, section }) => ({ sentence, factIds: fact_ids, section }));
  expect(validateGuide([guideFixture[0], ...body], ids, openingFixture)).toBeNull();
});

it("fits an overlong stop to the word cap by dropping its last story, then look, sentences down to each minimum", () => {
  const line = (section: "hook" | "look" | "story" | "takeaway", words = 20) => ({
    sentence: `${"word ".repeat(words - 1)}end.`,
    section,
  });
  const lines = (looks: number, stories: number, words = 20) => [
    line("hook", words),
    ...Array.from({ length: looks }, () => line("look", words)),
    ...Array.from({ length: stories }, () => line("story", words)),
    line("takeaway", words),
  ];
  // Fifteen facts ask for the full shape: at least two look and six story sentences.
  expect(fitWordCap(lines(3, 7), 15)).toEqual(lines(3, 6));
  expect(fitWordCap(lines(4, 6), 15)).toEqual(lines(3, 6));
  expect(fitWordCap(lines(2, 6), 15)).toEqual(lines(2, 6));
  expect(fitWordCap(lines(2, 6, 30), 15)).toEqual(lines(2, 6, 30));
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
    "Oil on canvas.",
    "Helsingør mod Kronborg, vinter",
    "Medium Oil on canvas on board",
    "Artist James HUCK (Scottish, b.1875, d.1940)",
    "Gift of J. Pierpont Morgan, 1907",
    "Overall: 21 3/4 × 33 7/8 in. (55.2 × 86 cm)",
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

it.each([
  [
    "この作品は、画家が庭の池に映る光を長年観察して描いた連作の一つです。",
    "画家は季節や時刻によって変わる水面の色を何度も描き続けました。",
  ],
  [
    "这幅画描绘了花园池塘中的睡莲以及水面上不断变化的光线和倒影。",
    "画家多年观察池塘中季节与光线的变化，并在这组作品中反复描绘同一景色。",
  ],
])("keeps substantial unspaced research available for translation and narration: %s", (...texts) => {
  const facts = texts.map((text, index) => ({ ...researchFixture[0], id: `f${index + 1}`, text }));
  expect(guideResearch(facts)).toEqual(facts);
  expect(narratable(guideResearch(facts))).toBe(true);
});

it("keeps short unspaced captions out while recognizing sentence punctuation", () => {
  const prose = "この絵は庭の池を描いています。";
  const facts = ["神奈川沖浪裏", "油彩、画布。", prose].map((text) => ({ ...researchFixture[0], text }));
  expect(guideResearch(facts).map(({ text }) => text)).toEqual([prose]);
  expect(narratable(guideResearch(facts))).toBe(false);
});

it("accepts a guide inside a word band whose floor shrinks with thin research", () => {
  const extra = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      sentence: `Extra sentence ${index + 1} about the lilies resting on the pond and the reflections of the garden around them.`,
      factIds: ["f1"],
      section: "story" as const,
    }));
  expect([1, 2, 4, 7, 8, 20].map(guideWordFloor)).toEqual([30, 40, 60, 90, 100, 100]);
  // The fixture sentences run 22, 38, 54, 70, 85 and 102 words cumulatively.
  expect(validateGuideBody(guideBodyFixture.slice(0, 6), richIds)).toHaveLength(6);
  expect(validateGuideBody(guideBodyFixture.slice(0, 5), richIds)).toBeNull();
  expect(validateGuideBody(guideBodyFixture.slice(0, 2), ids)).toBeNull();
  expect(validateGuideBody(guideBodyFixture.slice(0, 3), ids)).toHaveLength(3);
  expect(validateGuideBody([...guideBodyFixture, ...extra(2)], richIds)).toHaveLength(12);
  expect(validateGuideBody([...guideBodyFixture, ...extra(3)], richIds)).toBeNull();
});

it("tells the writer which rule a script broke", () => {
  expect(guideBodyProblems(guideBodyFixture.slice(0, 5), richIds)).toEqual([
    "The script has 85 words after the opening; it needs 100 to 225.",
  ]);
  expect(
    guideBodyProblems([...guideBodyFixture.slice(0, 6), { ...guideBodyFixture[1], section: "story" }], richIds),
  ).toEqual([`"${guideBodyFixture[1].sentence}" is repeated.`]);
});

it("keeps an editor's insertion inside a quote but not a citation", () => {
  const quoted = (sentence: string) => [
    ...guideBodyFixture.slice(0, 6),
    { sentence, factIds: ["f1"], section: "story" },
  ];
  expect(validateGuideBody(quoted("Monet wrote that ‘[t]he light changes constantly.’"), richIds)).toHaveLength(7);
  expect(validateGuideBody(quoted("He called it ‘my [most] beautiful canvas.’"), richIds)).toHaveLength(7);
  expect(validateGuideBody(quoted("The garden [f1] appears twice."), richIds)).toBeNull();
  expect(validateGuideBody(quoted("The garden [citation needed] appears twice."), richIds)).toBeNull();
});

it("shapes the stop to its research: about two sentences a fact, the full shape from eight facts", () => {
  const sizes = (factCount: number) => {
    const shape = guideShape(factCount);
    return GUIDE_SECTIONS.map((section) => shape[section]);
  };
  expect(sizes(2)).toEqual([
    [1, 1],
    [1, 2],
    [1, 2],
    [1, 1],
  ]);
  expect(sizes(4)).toEqual([
    [1, 2],
    [2, 4],
    [2, 4],
    [1, 2],
  ]);
  expect(sizes(7)).toEqual([
    [1, 2],
    [2, 4],
    [5, 7],
    [1, 2],
  ]);
  expect(sizes(8)).toEqual([
    [1, 2],
    [2, 4],
    [6, 7],
    [1, 2],
  ]);
});

it("asks for the thread and quote first, then short hook, look, story and takeaway sentences citing real facts", () => {
  const full = guideSchema([...richIds]);
  const thin = guideSchema([...ids]);
  expect(Object.keys(full.properties)).toEqual(["thread", "quote", "hook", "look", "story", "takeaway"]);
  expect(full.required).toEqual(["thread", "quote", "hook", "look", "story", "takeaway"]);
  expect(full.properties.story.minItems).toBe(6);
  expect([thin.properties.story.minItems, thin.properties.story.maxItems]).toEqual([1, 2]);
  expect(thin.properties.story.items.properties.fact_ids.items.enum).toEqual(["f1", "f2"]);
  expect(thin.properties.quote.anyOf[0].properties?.fact_id.enum).toEqual(["f1", "f2"]);
  const relaxed = guideSchema([...richIds], { relaxed: true });
  expect(GUIDE_SECTIONS.map((section) => relaxed.properties[section].minItems)).toEqual([1, 1, 1, 1]);
  expect(relaxed.properties.story.maxItems).toBe(full.properties.story.maxItems);
  expect(full.properties.look.items.properties.sentence.maxLength).toBe(140);
  expect(full.properties.hook.items.properties.sentence.maxLength).toBe(170);
});
