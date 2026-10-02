import { sortWorksByArtist } from "@/lib/collection/search";

import {
  filterVisits,
  formatElapsed,
  formatVisitDate,
  formatVisitStart,
  groupHistoryByMonth,
  summarizeJournal,
  type JournalVisit,
} from "./history";
import { pageRows } from "./query";

const visit = (localId: string, fields: Partial<JournalVisit> = {}): JournalVisit => ({
  visibility: "public" as const,
  owner: "account:me",
  localId,
  venueId: "museum" as never,
  venueName: "Musée d’Orsay",
  visitedOn: "2024-02-29",
  timeZone: "Pacific/Kiritimati",
  city: "París",
  country: "FR",
  cityKey: "wikidata:Q90",
  startedAt: null,
  endedAt: null,
  reflection: null,
  remoteVisitId: null,
  syncedAt: null,
  syncedBy: null,
  revision: 0,
  ...fields,
});

it("searches dates and geography and groups months without a phone timezone conversion", () => {
  const rows = [visit("a"), visit("b", { visitedOn: "2024-03-01" })];
  for (const query of ["musee", "paris", "fr", "france", "2024-02-29", "29 feb 2024", "February"]) {
    expect(filterVisits(rows, query)).toContain(rows[0]);
  }
  expect(formatVisitDate("2024-02-29")).toBe("29 Feb 2024");
  expect(groupHistoryByMonth(rows).map(({ title, data }) => [title, data.map((row) => row.localId)])).toEqual([
    ["March 2024", ["b"]],
    ["February 2024", ["a"]],
  ]);
});

it("counts repeat and empty visits, merges canonical cities and separates unresolved names", () => {
  const rows = [
    visit("1"),
    visit("2"),
    visit("3", { venueId: "museum-2" as never }),
    visit("4", { venueId: "unresolved" as never, cityKey: null }),
    visit("5", { venueId: "another-unresolved" as never, cityKey: null }),
    visit("6", {
      venueId: "texas" as never,
      country: "US",
      cityKey: "wikidata:Q16555",
    }),
    visit("7", { venueId: "country-only" as never, city: null, cityKey: null }),
    visit("8", {
      venueId: "missing" as never,
      venueName: "Unknown Museum",
      city: null,
      cityKey: null,
      country: null,
    }),
  ];
  const places = summarizeJournal(rows, "place");
  expect(places).toHaveLength(6);
  expect(places.find((row) => row.key === "wikidata:Q90")).toMatchObject({
    museumCount: 2,
    visitCount: 3,
    latestVisitedOn: "2024-02-29",
  });
  expect(places.find((row) => row.key === "country:FR")).toMatchObject({
    name: "France",
  });
  expect(places.find((row) => row.key === "venue:missing")).toMatchObject({
    name: "Unknown Museum",
  });
  expect(summarizeJournal(rows, "museum").find((row) => row.key === "museum")).toMatchObject({
    visitCount: 2,
  });
});

it("uses stable cursors and rejects cursors from a different owner or filter", () => {
  const key = (row: JournalVisit) => `${row.visitedOn}|${row.localId}`;
  const rows = [visit("a"), visit("b"), visit("c")];
  const first = pageRows(rows, key, "owner-a", { limit: 1 });
  const second = pageRows([visit("d"), ...rows], key, "owner-a", {
    limit: 2,
    cursor: first.cursor,
  });
  expect(second.page.map((row) => row.localId)).toEqual(["b", "a"]);
  expect(second.isDone).toBe(true);
  expect(() => pageRows(rows, key, "owner-b", { cursor: first.cursor })).toThrow("invalid_pagination");
});

it("sorts by artist display name, parsed year, title and save UUID, with undated works last", () => {
  const row = (localId: string, artist: string, date: string | null, title = "Painting") => ({
    localId,
    artist,
    date,
    title,
  });
  const rows = [
    row("undated", "Claude Monet", null),
    row("late", "Claude Monet", "c. 1916"),
    row("early-z", "Claude Monet", "1860–1865"),
    row("early-a", "Claude Monet", "1860"),
    row("alpha", "Álvaro Siza", null),
    row("pablo", "Pablo Picasso", "1900"),
  ];
  expect(sortWorksByArtist(rows).map((row) => row.localId)).toEqual([
    "alpha",
    "early-a",
    "early-z",
    "late",
    "undated",
    "pablo",
  ]);
});

it("shows a visit start as a time on its own museum day and as a date afterwards", () => {
  const startedAt = Date.UTC(2026, 8, 18, 21, 10);
  expect(formatVisitStart(startedAt, "America/New_York", Date.UTC(2026, 8, 18, 22))).toBe("5:10 PM");
  expect(formatVisitStart(startedAt, "America/New_York", Date.UTC(2026, 8, 19, 15))).toBe("18 Sep 2026");
  expect(formatVisitStart(startedAt, "Asia/Tokyo", Date.UTC(2026, 8, 18, 22))).toBe("6:10 AM");
});

it("formats elapsed time in hours and minutes", () => {
  expect(formatElapsed(12 * 60_000)).toBe("12m");
  expect(formatElapsed(83 * 60_000)).toBe("1h 23m");
  expect(formatElapsed(-5)).toBe("0m");
});
