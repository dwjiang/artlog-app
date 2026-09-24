import { describe, expect, it } from "vitest";

import {
  artistMentioned,
  exactTitle,
  jaccard,
  mentions,
  normalizeText,
  personMatches,
  segments,
  titleMatches,
  titleSimilarity,
} from "./textMatch";

describe("text matching", () => {
  it.each([
    ["A Sunday on La Grande Jatte", "Study for A Sunday on La Grande Jatte"],
    ["Study for A Sunday on La Grande Jatte", "A Sunday on La Grande Jatte"],
    ["After the Bath", "After the Bath Poster"],
    ["After the Bath", "After the Bath | Paper Print"],
    ["Study for After the Bath", "Sketch for After the Bath"],
  ])('distinguishes the requested work "%s" from "%s"', (label, candidate) => {
    expect(titleMatches(label, candidate)).toBe(false);
  });

  it.each([
    ["After the Bath", "Edgar Degas - After the Bath | Museum"],
    ["Study for A Sunday on La Grande Jatte", "Study for A Sunday on La Grande Jatte — 1884"],
    ["Study for After the Bath", "Studies for After the Bath"],
  ])('allows matching qualifiers in "%s" and "%s"', (label, candidate) => {
    expect(titleMatches(label, candidate)).toBe(true);
  });

  it("normalizes case, diacritics and punctuation", () => {
    expect(normalizeText("  Cruzando el Río Bravo — 1884!")).toBe("cruzando el rio bravo 1884");
    expect(jaccard("Water Lilies", "Lilies, Water")).toBe(1);
    expect(jaccard("", "x")).toBe(0);
  });

  it("matches a label title against the best segment of a page title", () => {
    expect(segments("Claude Monet - Water Lilies - The Metropolitan Museum of Art")).toEqual([
      "Claude Monet - Water Lilies - The Metropolitan Museum of Art",
      "Claude Monet",
      "Water Lilies",
      "The Metropolitan Museum of Art",
    ]);
    expect(titleMatches("Water Lilies", "Claude Monet - Water Lilies - The Metropolitan Museum of Art")).toBe(true);
    expect(
      titleMatches(
        "Water Lilies",
        "Claude Monet - Bridge over a Pond of Water Lilies - The Metropolitan Museum of Art",
      ),
    ).toBe(false);
    expect(titleSimilarity("A Sunday on La Grande Jatte", "A Sunday on La Grande Jatte — 1884")).toBe(1);
    expect(titleSimilarity("A Sunday on La Grande Jatte", "A Sunday on La Grande Jatte—1884")).toBeCloseTo(6 / 7);
    expect(exactTitle("The Starry Night", "Vincent van Gogh. The Starry Night. Saint Rémy, June 1889 | MoMA")).toBe(
      true,
    );
    expect(exactTitle("Water Lilies", "Bridge over a Pond of Water Lilies")).toBe(false);
  });

  it("finds whole-phrase mentions in page text", () => {
    expect(
      mentions("Studies for A Sunday on La Grande Jatte—1884, now a centerpiece", "A Sunday on La Grande Jatte"),
    ).toBe(true);
    expect(mentions("Water Lilies and Japanese Bridge", "Lilies and")).toBe(true);
    expect(mentions("Waterlilies", "Water Lilies")).toBe(false);
  });

  it.each([
    ["Claude Monet", "Monet, Claude", true],
    ["J. M. W. Turner", "Joseph Mallord William Turner", true],
    ["Monet", "Claude Monet", true],
    ["Claude Monet", "Camille Monet", false],
    ["Vincent van Gogh", "Theo van Gogh", false],
    ["Edward Hopper", "Edward Hopper Jr.", true],
    ["Georges Seurat", "Georges-Pierre Seurat", true],
    ["Jan Brueghel the Elder", "Jan Brueghel the Younger", false],
    ["Jan Brueghel the Younger", "Jan Brueghel the Elder", false],
    ["Jan Brueghel the Elder", "Brueghel, Jan the Elder", true],
    ["John Smith Jr.", "John Smith Sr.", false],
    ["John Smith Jr.", "John Smith Junior", true],
    ["John Smith II", "John Smith III", false],
    ["Jan Brueghel the Younger", "Pieter Brueghel the Younger", false],
    ["Jan Brueghel the Younger", "Brueghel, Pieter the Younger", false],
    ["Jan van der Meer", "Pieter van der Meer", false],
    ["Jan van der Meer", "van der Meer, Jan", true],
    ["Claude Oscar Monet", "Monet, Claude", true],
    ["Edward Hopper", "Hopper, Edward, Jr.", true],
    ["J. M. W. Turner", "Turner, Joseph Mallord William", true],
  ])("compares person names: %s vs %s → %s", (a, b, expected) => {
    expect(personMatches(a, b)).toBe(expected);
  });

  it("accepts explicit abbreviated and reordered artist names", () => {
    expect(artistMentioned("This is a description of an oil painting by JMW Turner", "J. M. W. Turner")).toBe(true);
    expect(artistMentioned("A painting by JMW Turner", "Joseph Mallord William Turner")).toBe(true);
    expect(artistMentioned("A painting by J. M. W. Turner", "Joseph Mallord William Turner")).toBe(true);
    expect(artistMentioned("Artist: Monet, Claude", "Claude Monet")).toBe(true);
    expect(artistMentioned("## Artist\n: Georges Seurat", "Georges Seurat")).toBe(true);
    expect(artistMentioned("A painting by Wei Li", "Ana Li")).toBe(false);
  });

  it.each([
    ["Water Lilies by Camille Monet", "Claude Monet"],
    ["A painting by Theo van Gogh", "Vincent van Gogh"],
    ["A work by Monet", "Claude Monet"],
    ["Water Lilies", ""],
  ])('does not use "%s" to establish the full artist name "%s"', (text, artist) => {
    expect(artistMentioned(text, artist)).toBe(false);
  });
});
