import { friendPicks, nearbyMuseums, savedExhibitions } from "./lists";
import { museumExhibitions, museumSummary } from "./museum-summary";
import type { Exhibition, ExploreData, ExploreFriend, ExploreMuseum } from "./types";

const friend = (name: string): ExploreFriend => ({ profileId: name, name, avatar: "klee" });
const museum = (id: string, distanceM?: number): ExploreMuseum => ({ id, name: id, lat: 0, lng: 0, distanceM });
const show = (id: string, startsOn: string, endsOn: string, friends: string[] = [], museumId = "near"): Exhibition => ({
  id,
  title: id,
  museumId,
  startsOn,
  endsOn,
  sourceUrl: `https://example.com/${id}`,
  friends: friends.map(friend),
});

const data: ExploreData = {
  city: { id: "chicago", name: "Chicago" },
  cities: [{ id: "chicago", name: "Chicago" }],
  nearby: true,
  following: true,
  today: "2026-10-04",
  museums: [museum("far", 12_500), museum("near", 950), museum("empty", 4800)],
  exhibitions: [
    show("closed", "2026-06-01", "2026-10-03", ["Maya", "Sam", "Jonah"]),
    show("closed-earlier", "2026-05-01", "2026-09-01"),
    show("two-later", "2026-09-12", "2027-01-18", ["Maya", "Sam"]),
    show("two-sooner", "2026-10-17", "2026-12-28", ["Maya", "Priya"], "far"),
    show("four", "2026-07-03", "2026-10-12", ["Maya", "Jonah", "Sam", "Priya"]),
    show("none", "2026-09-25", "2026-12-12"),
    show("upcoming", "2026-10-24", "2027-02-07"),
  ],
};
const ids = (list: Exhibition[]) => list.map((exhibition) => exhibition.id);

it("ranks friends' picks by how many friends want to see them, skipping closed shows", () => {
  expect(ids(friendPicks(data))).toEqual(["four", "two-sooner", "two-later"]);
});

it("orders museums nearest first, or by name without a location", () => {
  expect(nearbyMuseums(data).map((place) => place.id)).toEqual(["near", "empty", "far"]);
  const unplaced = { ...data, museums: [museum("Wrightwood"), museum("Art Institute"), museum("MCA")] };
  expect(nearbyMuseums(unplaced).map((place) => place.id)).toEqual(["Art Institute", "MCA", "Wrightwood"]);
});

it("lists saved shows still on or ahead, closing soonest first, then closed ones, most recent first", () => {
  const { current, closed } = savedExhibitions(
    data,
    new Set(["closed-earlier", "closed", "upcoming", "two-later", "four"]),
  );
  expect(ids(current)).toEqual(["four", "two-later", "upcoming"]);
  expect(ids(closed)).toEqual(["closed", "closed-earlier"]);
});

it("lists a museum's running shows by closing date, then its upcoming ones", () => {
  expect(ids(museumExhibitions(data, museum("near")))).toEqual(["four", "none", "two-later", "upcoming"]);
});

it("counts a museum's shows and the ones ending soon", () => {
  expect(museumSummary(data, museum("near"))).toEqual({ count: "4 exhibitions", ending: "1 ending soon" });
  expect(museumSummary(data, museum("far"))).toEqual({ count: "1 exhibition", ending: undefined });
  expect(museumSummary(data, museum("empty"))).toEqual({ count: "No exhibitions listed", ending: undefined });
});
