import regions from "@/shared/sources/regions.json";
import type { VenueRow } from "./resolve";
import { countryName } from "../journal/history";

type Region = { name: string; country?: string };
export function venueLocation(venue: VenueRow) {
  const region = venue.region.startsWith("country:")
    ? undefined
    : (regions as Record<string, Region>)[venue.region];
  const country =
    venue.country
    || region?.country
    || (venue.region.startsWith("country:")
      ? venue.region.slice(8)
      : undefined);
  return {
    country,
    regionName: region?.name,
    regionKey: region ? `region:${venue.region}` : undefined,
    location: [
      ...new Set(
        [venue.city || region?.name, countryName(country)].filter(Boolean),
      ),
    ].join(", "),
  };
}
export function regionSearchNames(): [string, string][] {
  return Object.entries(regions).map(([key, region]) => [key, region.name]);
}
