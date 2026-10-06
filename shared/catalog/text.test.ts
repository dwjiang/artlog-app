import { artistKey, catalogSearchText, normalizeText } from "./text";

describe("catalog text", () => {
  it("normalizes case, diacritics and punctuation", () => {
    expect(normalizeText("  Cruzando el Río Bravo — 1884!")).toBe("cruzando el rio bravo 1884");
  });

  it("gives an artist the same key however a source spells the name", () => {
    expect(artistKey("Claude Monet")).toBe("claude monet");
    expect(artistKey("CLAUDE  MONET")).toBe(artistKey("Claude Monet"));
    expect(artistKey("Pierre-Auguste Renoir")).toBe("pierre auguste renoir");
    expect(artistKey("Édouard Manet")).toBe("edouard manet");
  });

  it.each(["Unknown artist", "Unidentified artist", "Anonymous", "", "  —  "])("gives %j no key", (name) => {
    expect(artistKey(name)).toBeUndefined();
  });
});

describe("catalog search text", () => {
  it("searches the normalized words, at most 16 of them", () => {
    expect(catalogSearchText("Monet's  Water-Lilies")).toBe("monet s water lilies");
    expect(catalogSearchText(Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ")).split(" ")).toHaveLength(16);
  });

  it.each(["", "   ", "#$%", "x".repeat(101)])("has nothing to look up for %j", (query) => {
    expect(catalogSearchText(query)).toBe("");
  });
});
