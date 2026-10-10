import regions from "../../shared/sources/regions.json";

type Region = { name: string; domains: string[]; country?: string };

// A museum's region is a metro key or `country:<ISO>`. Unconfigured coverage returns
// null so "Right now" is suppressed rather than searched without a domain filter.
export function regionDomains(region: string): string[] | null {
  const entry = (regions as Record<string, Region | undefined>)[region];
  return entry?.domains.length ? entry.domains : null;
}

/** The ISO country of a metro key or `country:<ISO>` region. */
export function regionCountry(region: string): string | undefined {
  if (region.startsWith("country:")) return region.slice("country:".length);
  return (regions as Record<string, Region | undefined>)[region]?.country;
}
