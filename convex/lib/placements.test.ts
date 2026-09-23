import { describe, expect, it } from "vitest";

import { currentPlacement, type PlacementLike } from "./placements";

const day = 24 * 60 * 60 * 1000;
const now = 100 * day;

function placement(overrides: Partial<PlacementLike> & { venueId: string }): PlacementLike {
  return { onView: true, source: "wikidata", confidence: 0.5, ...overrides };
}

describe("currentPlacement", () => {
  it("returns null when nothing is active", () => {
    expect(currentPlacement([], now)).toBeNull();
    expect(
      currentPlacement(
        [
          placement({ venueId: "past", to: now - day }),
          placement({ venueId: "future", from: now + day }),
        ],
        now,
      ),
    ).toBeNull();
  });

  it("prefers a dated checklist placement inside its window and the home placement outside it", () => {
    const home = placement({ venueId: "home", source: "wikidata", confidence: 0.9 });
    const loan = placement({
      venueId: "loan",
      source: "checklist",
      confidence: 0.6,
      from: now - 10 * day,
      to: now + 10 * day,
    });

    expect(currentPlacement([home, loan], now)).toBe(loan);
    expect(currentPlacement([home, loan], now + 20 * day)).toBe(home);
    expect(currentPlacement([home, loan], now - 20 * day)).toBe(home);
  });

  it("excludes closed placements", () => {
    const closed = placement({ venueId: "old", source: "manual", closedAt: now - day });
    const open = placement({ venueId: "new", source: "proposal" });

    expect(currentPlacement([closed, open], now)).toBe(open);
    expect(currentPlacement([closed], now)).toBeNull();
  });

  it("ranks an active checklist above an off-view feed, preserving stronger location evidence", () => {
    const offView = placement({ venueId: "home", source: "feed", onView: false, confidence: 1 });
    const loan = placement({
      venueId: "loan",
      source: "checklist",
      from: now - day,
      to: now + day,
    });
    const feed = placement({ venueId: "confirmed", source: "feed" });
    const manual = placement({ venueId: "manual", source: "manual", onView: false });
    const proposal = placement({ venueId: "proposed", source: "proposal" });

    for (const rows of [
      [offView, loan],
      [loan, offView],
    ])
      expect(currentPlacement(rows, now)).toBe(loan);
    expect(currentPlacement([offView, loan], now + 2 * day)).toBe(offView);
    expect(currentPlacement([offView, loan, feed], now)).toBe(feed);
    expect(currentPlacement([offView, loan, manual], now)).toBe(manual);
    expect(currentPlacement([offView, proposal], now)).toBe(offView);
  });

  it("breaks a source tie by confidence, then by the latest start", () => {
    const weak = placement({ venueId: "weak", source: "wikidata", confidence: 0.3 });
    const strong = placement({ venueId: "strong", source: "wikidata", confidence: 0.8 });
    expect(currentPlacement([weak, strong], now)).toBe(strong);

    const earlier = placement({
      venueId: "earlier",
      source: "feed",
      confidence: 0.8,
      from: now - 5 * day,
    });
    const later = placement({ venueId: "later", source: "feed", confidence: 0.8, from: now - day });
    const openEnded = placement({ venueId: "open", source: "feed", confidence: 0.8 });
    expect(currentPlacement([openEnded, earlier, later], now)).toBe(later);
  });
});
