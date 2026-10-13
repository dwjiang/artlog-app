import type { Id } from "../../../convex/_generated/dataModel";
import { catalogAsOf, defaultCity, exploreCities, exploreData } from "./catalog";

const museumId = "omca" as Id<"museums">;
const show = (title: string, viewingPeriods: { startDate: string | null; endDate: string }[], imageUrl?: string) => ({
  exhibitionId: title as Id<"exhibitions">,
  museumId,
  title,
  sourceUrl: `https://museumca.org/${title}`,
  imageUrl,
  viewingPeriods,
});
const catalog = {
  museums: [{ museumId, name: "Oakland Museum of California", city: null, lat: 37.798641, lng: -122.263611 }],
  exhibitions: [
    show("on-view", [{ startDate: "2026-09-01", endDate: "2026-10-09" }], "https://museumca.org/media/on-view.jpg"),
    show("ended-locally", [{ startDate: "2026-09-01", endDate: "2026-10-08" }]),
    show("closing-only", [{ startDate: null, endDate: "2026-12-01" }]),
    show("between-periods", [
      { startDate: "2026-09-22", endDate: "2026-10-05" },
      { startDate: "2026-10-20", endDate: "2026-12-11" },
    ]),
  ],
};
const regions = [
  { region: "sf-bay-area", lat: 37.785718, lng: -122.401051 },
  { region: "london", lat: 51.5081, lng: -0.0997 },
  { region: "country:FR", lat: 43.7, lng: 7.27 },
];
const place = { city: { id: "sf-bay-area", name: "San Francisco Bay Area" }, cities: [], today: "2026-10-09" };

it("reads each show's current or next viewing period, or its last one once it has closed", () => {
  const shows = exploreData(catalog, place, undefined, undefined).exhibitions;
  expect(shows.map(({ id, startsOn, endsOn }) => ({ id, startsOn, endsOn }))).toEqual([
    { id: "on-view", startsOn: "2026-09-01", endsOn: "2026-10-09" },
    { id: "ended-locally", startsOn: "2026-09-01", endsOn: "2026-10-08" },
    { id: "closing-only", startsOn: undefined, endsOn: "2026-12-01" },
    { id: "between-periods", startsOn: "2026-10-20", endsOn: "2026-12-11" },
  ]);
  expect(shows[0]).toMatchObject({
    museumId,
    sourceUrl: "https://museumca.org/on-view",
    image: { uri: "https://museumca.org/media/on-view.jpg", label: "on-view" },
    friends: [],
  });
  expect(shows[2].image).toBeUndefined();
});

it("measures museums from the phone in the person's units once both are known", () => {
  const berkeley = { lat: 37.870804, lng: -122.26634 };
  expect(exploreData(catalog, place, berkeley, "imperial").museums[0]).toMatchObject({ distance: "5.0 mi" });
  expect(exploreData(catalog, place, berkeley, undefined).museums[0].distance).toBeUndefined();
  expect(exploreData(catalog, place, undefined, "metric").museums[0]).toMatchObject({
    distanceM: undefined,
    distance: undefined,
  });
});

it("names cities alphabetically and opens on the one nearest the phone", () => {
  expect(exploreCities(regions)).toEqual([
    { id: "country:FR", name: "France" },
    { id: "london", name: "London" },
    { id: "sf-bay-area", name: "San Francisco Bay Area" },
  ]);
  expect(defaultCity(regions, { lat: 37.87, lng: -122.27 })).toBe("sf-bay-area");
  expect(defaultCity(regions, undefined)).toBe("country:FR");
  expect(defaultCity([], undefined)).toBeUndefined();
});

it("asks the server for shows that have not closed anywhere it is still today", () => {
  expect(catalogAsOf("2026-10-09")).toBe(Date.parse("2026-10-08T00:00:00Z"));
});
