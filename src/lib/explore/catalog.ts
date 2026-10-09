import type { FunctionReturnType } from "convex/server";

import type { MeasurementUnits } from "@/lib/settings/measurement-units";
import { formatDistance, haversineMeters, type Coordinate } from "@/lib/venue/resolve";
import { regionName } from "@/lib/venue/venue-location";

import type { api } from "../../../convex/_generated/api";
import type { ExploreCatalog, ExploreCity, ExploreData } from "./types";

type Regions = FunctionReturnType<typeof api.exhibitions.regions>;
type RegionCatalog = FunctionReturnType<typeof api.exhibitions.inRegion>;

const DAY = 86_400_000;

/** A day before today's UTC midnight is still today somewhere, so the server keeps every show not yet closed locally. */
export const catalogAsOf = (today: string) => Date.parse(today) - DAY;

export function exploreCities(regions: Regions): ExploreCity[] {
  return regions
    .map(({ region }) => ({ id: region, name: regionName(region) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The region nearest the phone, or the first by name without a location fix. */
export function defaultCity(regions: Regions, fix?: Coordinate): string | undefined {
  if (!fix) return exploreCities(regions)[0]?.id;
  const nearest = [...regions].sort((a, b) => haversineMeters(fix, a) - haversineMeters(fix, b));
  return nearest[0]?.region;
}

export function exploreData(
  catalog: RegionCatalog,
  place: { city: ExploreCity; cities: ExploreCity[]; today: string },
  fix: Coordinate | undefined,
  units: MeasurementUnits | undefined,
): ExploreData {
  return { ...place, ...catalogData(catalog, place.today, fix, units) };
}

export function catalogData(
  catalog: RegionCatalog,
  today: string,
  fix: Coordinate | undefined,
  units: MeasurementUnits | undefined,
): ExploreCatalog {
  return {
    today,
    museums: catalog.museums.map((museum) => {
      const distanceM = fix && haversineMeters(fix, museum);
      return {
        id: museum.museumId,
        name: museum.name,
        city: museum.city ?? undefined,
        lat: museum.lat,
        lng: museum.lng,
        distanceM,
        distance: distanceM !== undefined && units ? formatDistance(distanceM, units) : undefined,
      };
    }),
    exhibitions: catalog.exhibitions.flatMap((row) => {
      // The viewing period under way or next; a show closed between periods reads as opening again.
      const period = row.viewingPeriods.find((candidate) => candidate.endDate >= today);
      if (!period) return [];
      return [
        {
          id: row.exhibitionId,
          title: row.title,
          museumId: row.museumId,
          startsOn: period.startDate ?? undefined,
          endsOn: period.endDate,
          sourceUrl: row.sourceUrl,
          image: row.imageUrl ? { uri: row.imageUrl, label: row.title } : undefined,
          friends: [],
        },
      ];
    }),
  };
}
