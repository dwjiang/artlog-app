import regions from "./regions.json";

const COUNTRY_PREFIX = "country:";

/** A `country:<ISO>` region covers a whole country; any other region is one metro. */
export const isCountryRegion = (region: string) => region.startsWith(COUNTRY_PREFIX);

/** The ISO country of a metro key or `country:<ISO>` region. */
export function regionCountry(region: string): string | undefined {
  if (isCountryRegion(region)) return region.slice(COUNTRY_PREFIX.length);
  return (regions as Record<string, { country?: string } | undefined>)[region]?.country;
}
