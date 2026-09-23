import { describe, expect, it } from "vitest";

import { assessPlausibility, lifespanWindow, parseYearRange } from "./plausibility";

describe("plausibility", () => {
  it.each([
    ["1919", { start: 1919, end: 1919 }],
    ["1916–19", { start: 1916, end: 1919 }],
    ["c. 1503–1519", { start: 1503, end: 1519 }],
    ["1884/86", { start: 1884, end: 1886 }],
    ["1880–81, cast 1916", { start: 1880, end: 1916 }],
    ["Made 1942", { start: 1942, end: 1942 }],
    ["19th century", { start: 1801, end: 1900 }],
    ["n.d.", null],
    ["130.2 x 200.7 cm", null],
  ])('parses "%s"', (value, expected) => {
    expect(parseYearRange(value)).toEqual(expected);
  });

  it("builds the lifespan window from birth and death, birth only, or death only", () => {
    expect(lifespanWindow({ birth: 1840, death: 1926 })).toEqual({ start: 1840, end: 1926 });
    expect(lifespanWindow({ birth: 1980 }, 2026)).toEqual({ start: 1990, end: 2026 });
    expect(lifespanWindow({ death: 1926 })).toEqual({ start: 1806, end: 1926 });
    expect(lifespanWindow({})).toBeNull();
  });

  it("warns when the date falls outside the artist lifespan and stays quiet inside it", () => {
    const lifespan = { birth: 1840, death: 1926 };
    expect(assessPlausibility({ artistFound: true, lifespan, date: "1919" })).toEqual([]);
    expect(assessPlausibility({ artistFound: true, lifespan, date: "1950" })).toEqual([
      "date_outside_lifespan",
    ]);
    expect(assessPlausibility({ artistFound: true, lifespan, date: "1920–1930" })).toEqual([]);
    expect(assessPlausibility({ artistFound: true, lifespan, date: "undated" })).toEqual([]);
  });

  it("reports an unresolved artist and an unlikely venue without inventing lifespan checks", () => {
    expect(assessPlausibility({ artistFound: false, date: "1950" })).toEqual(["artist_not_found"]);
    expect(
      assessPlausibility({
        artistFound: true,
        lifespan: {},
        date: "1950",
        venueCountryMatch: false,
      }),
    ).toEqual(["venue_unlikely"]);
    expect(assessPlausibility({ artistFound: true, venueCountryMatch: true })).toEqual([]);
    expect(assessPlausibility({})).toEqual([]);
  });
});
