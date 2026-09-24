import type { ArtworkEncounter, Visit, SavedWork } from "@/db/schema";
import type { VenueRow } from "@/lib/venue/resolve";

import { groupHistoryByMonth } from "./history";
import { mappedMuseums, searchVisitSummaries, visitCounts, visitSummaries, visitsAtPlace } from "./visit-summaries";

const visit = (localId: string, visitedOn: string, venueId = "museum"): Visit =>
  ({
    owner: "a",
    localId,
    visitedOn,
    venueId,
    venueName: "Musée d’Orsay",
    timeZone: "Europe/Paris",
    reflection: "private",
    revision: 0,
  }) as Visit;
const work = (localId: string, visitLocalId: string | null, extra = {}): SavedWork =>
  ({
    owner: "a",
    localId,
    visitLocalId,
    title: "Water Lilies",
    artist: "Claude Monet",
    savedAt: 1,
    deletedAt: null,
    ...extra,
  }) as SavedWork;
const metadata = new Map<string, VenueRow>([
  [
    "museum",
    {
      region: "paris",
      city: "Paris",
      cityKey: "paris",
      country: "FR",
      lat: 48.86,
      lng: 2.32,
    } as VenueRow,
  ],
]);
const summaries = () =>
  visitSummaries(
    [visit("old", "2024-01-01"), visit("repeat", "2024-02-29"), visit("new", "2024-02-29", "unmapped")],
    [
      work("painting", "old"),
      work("import", null),
      work("foreign", "old", { owner: "b" }),
      work("deleted", "old", { deletedAt: 1 }),
    ],
    metadata,
    "a",
    [
      {
        owner: "a",
        savedLocalId: "painting",
        visitLocalId: "old",
        deletedAt: null,
      } as ArtworkEncounter,
    ],
  );

it("sorts repeat and empty visits newest first and groups calendar months", () => {
  const rows = summaries();
  expect(rows.map((row) => row.localId)).toEqual(["repeat", "new", "old"]);
  expect(rows.map((row) => row.works.length)).toEqual([0, 0, 1]);
  expect(groupHistoryByMonth(rows).map((group) => group.title)).toEqual(["February 2024", "January 2024"]);
  expect(visitCounts(rows)).toEqual({ museums: 2, visits: 3 });
});

it("searches museum, country, place, date, and saved art while retaining whole visits", () => {
  for (const query of ["orsay", "France", "Paris", "2024-01-01", "Monet"]) {
    expect(searchVisitSummaries(summaries(), query).map((row) => row.localId)).toContain("old");
  }
  expect(searchVisitSummaries(summaries(), "Monet")).toHaveLength(1);
  expect(searchVisitSummaries(summaries(), "private")).toEqual([]);
  expect(searchVisitSummaries(summaries(), "x")).toEqual([]);
});

it("maps each museum once and keeps unmapped visits in the timeline", () => {
  expect(mappedMuseums(summaries()).map((row) => row.localId)).toEqual(["repeat"]);
  expect(visitsAtPlace(summaries(), "paris")).toHaveLength(2);
  expect(summaries()).toHaveLength(3);
});

it("never includes another owner’s visits", () => {
  expect(visitSummaries([visit("secret", "2024-01-01")], [], metadata, "b")).toEqual([]);
});

it("uses bundled region labels when a museum has no city metadata", () => {
  const rows = visitSummaries(
    [visit("one", "2024-01-01")],
    [],
    new Map([["museum", { region: "new-york", lat: 40, lng: -73 } as VenueRow]]),
    "a",
  );
  expect(rows[0].location).toBe("New York, United States");
  expect(visitsAtPlace(rows, "region:new-york")).toHaveLength(1);
  expect(searchVisitSummaries(rows, "new york")).toHaveLength(1);
});
