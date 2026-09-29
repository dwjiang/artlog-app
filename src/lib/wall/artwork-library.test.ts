import type { SavedWork } from "@/db/schema";

import { canHangArtwork, libraryArtworks } from "./artwork-library";

const work = (localId: string, title: string, artist: string, savedAt: number) =>
  ({
    localId,
    title,
    artist,
    savedAt,
    deletedAt: null,
    syncedBy: "device",
    visitLocalId: null,
  }) as SavedWork;
const works = [work("a", "Zinnias", "Émile", 2), work("b", "Apples", "Zoe", 1), work("c", "Clouds", "Ada", 3)];
const filter = { search: "", sort: "recent" as const, notOnWall: false, hungIds: new Set<string>() };

it("orders the whole library by recency, title, or artist without changing the collection", () => {
  expect(libraryArtworks(works, filter).map((item) => item.localId)).toEqual(["c", "a", "b"]);
  expect(libraryArtworks(works, { ...filter, sort: "title" }).map((item) => item.localId)).toEqual(["b", "c", "a"]);
  expect(libraryArtworks(works, { ...filter, sort: "artist" }).map((item) => item.localId)).toEqual(["c", "a", "b"]);
  expect(works.map((item) => item.localId)).toEqual(["a", "b", "c"]);
});

it("combines title and artist search with visit membership and excludes deleted or hung art", () => {
  const visit = { localId: "visit", venueName: "Museum", visitedOn: "2026-09-20", works: [works[0], works[1]] };
  expect(libraryArtworks(works, { ...filter, search: "émile zin", visit })).toEqual([works[0]]);
  expect(
    libraryArtworks([...works, { ...works[0], localId: "deleted", deletedAt: 1 }], {
      ...filter,
      visit,
      notOnWall: true,
      hungIds: new Set(["a"]),
    }),
  ).toEqual([works[1]]);
});

it("allows local guest art and previously synced edits, but waits for a new account save to sync", () => {
  expect(canHangArtwork({ ...works[0], syncedAt: null }, true)).toBe(true);
  expect(canHangArtwork({ ...works[0], syncedBy: null }, true)).toBe(false);
  expect(canHangArtwork({ ...works[0], syncedBy: null }, false)).toBe(true);
  expect(canHangArtwork({ ...works[0], deletedAt: 1 }, false)).toBe(false);
});
