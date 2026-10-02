import { describe, expect, it } from "vitest";

import { dailyJitter, pickPrior, type PickCandidate } from "./museumPicks";

const painting: PickCandidate = {
  title: "Wheat Field with Cypresses",
  artist: "Vincent van Gogh",
  medium: "Oil on canvas",
  multiplicity: "unique",
  onView: false,
  fromPaintingsSource: false,
};

describe("pickPrior", () => {
  it("ranks a painting Wikidata knew early above one from a later bulk import, and both above no entry", () => {
    const early = pickPrior({ ...painting, wikidataId: "Q1373862" })!;
    const bulk = pickPrior({ ...painting, wikidataId: "Q78655558" })!;
    const none = pickPrior(painting)!;
    expect(early).toBeGreaterThan(bulk);
    expect(bulk).toBeGreaterThan(none);
  });

  it("prefers works on view and paintings over prints, editions and unattributed works", () => {
    expect(pickPrior({ ...painting, onView: true })!).toBeGreaterThan(pickPrior(painting)!);
    expect(pickPrior({ ...painting, medium: "Etching" })!).toBeLessThan(pickPrior(painting)!);
    expect(pickPrior({ ...painting, medium: undefined, fromPaintingsSource: true })).toBe(pickPrior(painting));
    expect(pickPrior({ ...painting, multiplicity: "multiple" })!).toBeLessThan(pickPrior(painting)!);
    for (const artist of ["Unknown artist", "French Painter", "Workshop of Rubens", "Anonymous"]) {
      expect(pickPrior({ ...painting, artist })!).toBeLessThan(pickPrior(painting)!);
    }
  });

  it("leaves out Wikidata entries that never got a title", () => {
    expect(pickPrior({ ...painting, title: "Q114453254", wikidataId: "Q114453254" })).toBeNull();
  });
});

describe("dailyJitter", () => {
  it("is the same for everyone on one day and different the next", () => {
    expect(dailyJitter("met:2026-10-02", "work")).toBe(dailyJitter("met:2026-10-02", "work"));
    expect(dailyJitter("met:2026-10-03", "work")).not.toBe(dailyJitter("met:2026-10-02", "work"));
    expect(dailyJitter("met:2026-10-02", "work")).toBeGreaterThanOrEqual(0);
    expect(dailyJitter("met:2026-10-02", "work")).toBeLessThan(1);
  });
});
