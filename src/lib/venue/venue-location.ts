import { countryName, knownCountryName } from "@/lib/journal/history";
import { isCountryRegion, regionCountry } from "@/shared/sources/region-country";
import regions from "@/shared/sources/regions.json";

import type { VenueRow } from "./resolve";

type Region = { name: string; country?: string };
export function venueLocation(venue: VenueRow) {
  const region = isCountryRegion(venue.region) ? undefined : (regions as Record<string, Region>)[venue.region];
  const country = venue.country || regionCountry(venue.region);
  return {
    country,
    regionName: region?.name,
    regionKey: region ? `region:${venue.region}` : undefined,
    location: [...new Set([venue.city || region?.name, countryName(country)].filter(Boolean))].join(", "),
  };
}
/** "San Francisco Bay Area" for a metro region, the country's name for a `country:` one. */
export function regionName(region: string): string {
  return knownRegionName(region) ?? region;
}
/** Undefined for a region without a name, such as `country:unknown` or a former country like `country:DD`. */
export function knownRegionName(region: string): string | undefined {
  if (isCountryRegion(region)) return knownCountryName(regionCountry(region)!);
  return (regions as Record<string, Region | undefined>)[region]?.name;
}
export function regionSearchNames(): [string, string][] {
  return Object.entries(regions).map(([key, region]) => [key, region.name]);
}
