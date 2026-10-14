import type { FunctionReturnType } from "convex/server";

import type { MeasurementUnits } from "@/lib/settings/measurement-units";
import { formatDistance, haversineMeters, type Coordinate, type VenueRow } from "@/lib/venue/resolve";
import { regionName } from "@/lib/venue/venue-location";
import { regionCountry } from "@/shared/sources/region-country";

import type { api } from "../../../convex/_generated/api";
import { TIME_ZONE_PLACES } from "./time-zone-places";
import type { ExploreCatalog, ExploreCity, ExploreData } from "./types";

type Regions = FunctionReturnType<typeof api.exhibitions.regions>;
type RegionCatalog = FunctionReturnType<typeof api.exhibitions.inRegion>;
export type FriendSaves = FunctionReturnType<typeof api.wantToSee.friends>;

const DAY = 86_400_000;

/** A day before today's UTC midnight is still today somewhere, so the server keeps every show not yet closed locally. */
export const catalogAsOf = (today: string) => Date.parse(today) - DAY;

export function exploreCities(regions: Regions): ExploreCity[] {
  return regions
    .map(({ region }) => ({ id: region, name: regionName(region) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const nearestRegion = (regions: Regions, to: Coordinate) =>
  regions.reduce<Regions[number] | undefined>(
    (best, region) => (!best || haversineMeters(to, region) < haversineMeters(to, best) ? region : best),
    undefined,
  )?.region;

/**
 * The phone's own region when it has shows, else the one nearest the phone. Without a location fix, the one nearest
 * the time zone's main city, preferring the zone's country; else the first by name.
 */
export function defaultCity(
  regions: Regions,
  { fix, home, timeZone }: { fix?: Coordinate; home?: string; timeZone?: string } = {},
): string | undefined {
  if (home && regions.some(({ region }) => region === home)) return home;
  if (fix) return nearestRegion(regions, fix);
  const zone = timeZone ? TIME_ZONE_PLACES[timeZone] : undefined;
  if (!zone) return exploreCities(regions)[0]?.id;
  const [country, lat, lng] = zone;
  const local = regions.filter(({ region }) => regionCountry(region) === country);
  return nearestRegion(local.length > 0 ? local : regions, { lat, lng });
}

/** The city's shows with every museum in it, the server's record first for a museum that lists shows. */
export function exploreData(
  catalog: RegionCatalog,
  cityMuseums: readonly VenueRow[],
  place: Omit<ExploreData, keyof ExploreCatalog> & { today: string },
  fix: Coordinate | undefined,
  units: MeasurementUnits | undefined,
): ExploreData {
  const listed = new Set(catalog.museums.map((museum) => museum.museumId));
  const museums = [
    ...catalog.museums,
    ...cityMuseums
      .filter((museum) => !listed.has(museum.id))
      .map(({ id, name, city, lat, lng }) => ({ museumId: id, name, city: city ?? null, lat, lng })),
  ];
  return { ...place, ...catalogData({ ...catalog, museums }, place.today, fix, units) };
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
      // The viewing period under way or next, so a show closed between periods reads as opening again; past the last
      // period, a saved show reads as closed.
      const period = row.viewingPeriods.find((candidate) => candidate.endDate >= today) ?? row.viewingPeriods.at(-1);
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

/** Fills in the friends who want to see each show, most recent first. */
export function withFriends<T extends ExploreCatalog>(data: T, saves: FriendSaves): T {
  if (saves.length === 0) return data;
  const byShow = new Map<string, FriendSaves>();
  for (const save of saves) byShow.set(save.exhibitionId, [...(byShow.get(save.exhibitionId) ?? []), save]);
  return {
    ...data,
    exhibitions: data.exhibitions.map((exhibition) => ({
      ...exhibition,
      friends: (byShow.get(exhibition.id) ?? []).map(({ friend }) => friend),
    })),
  };
}
