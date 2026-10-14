import regions from "./regions.json";

/** The ISO country of a metro key or `country:<ISO>` region. */
export function regionCountry(region: string): string | undefined {
  if (region.startsWith("country:")) return region.slice("country:".length);
  return (regions as Record<string, { country?: string } | undefined>)[region]?.country;
}
