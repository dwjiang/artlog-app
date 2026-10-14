import type { Id } from "../../../convex/_generated/dataModel";
import { catalogAsOf, defaultCity, exploreCities, exploreData, namedRegions } from "./catalog";

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
const place = {
  city: { id: "sf-bay-area", name: "San Francisco Bay Area" },
  cities: [],
  nearby: false,
  following: false,
  today: "2026-10-09",
};

it("reads each show's current or next viewing period, or its last one once it has closed", () => {
  const shows = exploreData(catalog, [], place, undefined, undefined).exhibitions;
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
  expect(exploreData(catalog, [], place, berkeley, "imperial").museums[0]).toMatchObject({ distance: "5.0 mi" });
  expect(exploreData(catalog, [], place, berkeley, undefined).museums[0].distance).toBeUndefined();
  expect(exploreData(catalog, [], place, undefined, "metric").museums[0]).toMatchObject({
    distanceM: undefined,
    distance: undefined,
  });
});

it("lists every museum in the city, keeping the server's record for one that lists shows", () => {
  const venue = (id: string, name: string, city: string | null) => ({
    id: id as Id<"museums">,
    key: id,
    name,
    lat: 37.8,
    lng: -122.27,
    website: null,
    region: "sf-bay-area",
    city,
  });
  const { museums } = exploreData(
    catalog,
    [venue("omca", "OMCA (stale)", "Oakland"), venue("chabot", "Chabot Space & Science Center", null)],
    place,
    undefined,
    undefined,
  );
  expect(museums.map(({ id, name, city }) => ({ id, name, city }))).toEqual([
    { id: museumId, name: "Oakland Museum of California", city: undefined },
    { id: "chabot", name: "Chabot Space & Science Center", city: undefined },
  ]);
});

it("names cities alphabetically", () => {
  expect(exploreCities(regions)).toEqual([
    { id: "country:FR", name: "France" },
    { id: "london", name: "London" },
    { id: "sf-bay-area", name: "San Francisco Bay Area" },
  ]);
});

it("offers only regions it can name as cities", () => {
  const unnamed = [
    { region: "country:DD", lat: 51.06, lng: 13.74 },
    { region: "country:unknown", lat: 40.75, lng: -74.01 },
  ];
  expect(namedRegions([...regions, ...unnamed])).toEqual(regions);
});

it("opens on the phone's own city, else the nearest city with shows", () => {
  const nice = { lat: 43.7, lng: 7.27 };
  const paris = { lat: 48.86, lng: 2.34 };
  expect(defaultCity(regions, { fix: nice, home: "country:FR" })).toBe("country:FR");
  // London's museum is nearer Paris than the French one listing shows.
  expect(defaultCity(regions, { fix: paris, home: "paris" })).toBe("london");
  expect(defaultCity(regions, { fix: { lat: 37.87, lng: -122.27 } })).toBe("sf-bay-area");
});

it("without a location fix, opens near the time zone's main city, preferring the zone's country", () => {
  const withNewYork = [...regions, { region: "new-york", lat: 40.75, lng: -73.97 }];
  expect(defaultCity(withNewYork, { timeZone: "America/Los_Angeles" })).toBe("sf-bay-area");
  expect(defaultCity(withNewYork, { timeZone: "America/New_York" })).toBe("new-york");
  // Paris is nearer London's museum than the French one, but the zone's own country wins.
  expect(defaultCity(regions, { timeZone: "Europe/Paris" })).toBe("country:FR");
  // Nothing listed in Japan, so the nearest city anywhere.
  expect(defaultCity(regions, { timeZone: "Asia/Tokyo" })).toBe("sf-bay-area");
  expect(defaultCity(regions, { timeZone: "Mars/Olympus_Mons" })).toBe("country:FR");
  expect(defaultCity(regions)).toBe("country:FR");
  expect(defaultCity([])).toBeUndefined();
});

it("asks the server for shows that have not closed anywhere it is still today", () => {
  expect(catalogAsOf("2026-10-09")).toBe(Date.parse("2026-10-08T00:00:00Z"));
});

it.each([
  ["Asia/Calcutta", "country:IN", 22.53, 88.37],
  ["Asia/Katmandu", "country:NP", 27.72, 85.32],
  ["Europe/Kiev", "country:UA", 50.43, 30.52],
  ["Asia/Saigon", "country:VN", 10.75, 106.67],
  ["America/Buenos_Aires", "country:AR", -34.6, -58.45],
  ["Iceland", "country:IS", 64.15, -21.85],
  ["Pacific/Truk", "country:FM", 7.42, 151.78],
] as const)("places the time-zone alias %s in its own country", (timeZone, region, lat, lng) => {
  const listed = [...regions, { region: "country:AL", lat: 41.33, lng: 19.82 }, { region, lat, lng }];
  expect(defaultCity(listed, { timeZone })).toBe(region);
});
