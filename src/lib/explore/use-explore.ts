import type { FunctionReturnType } from "convex/server";
import { useNetworkState } from "expo-network";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useCurrentMinute } from "@/hooks/use-current-minute";
import { useLocalOwner } from "@/lib/account/owner-store";
import { isOffline } from "@/lib/network-state";
import { reportError } from "@/lib/observability";
import { useMeasurementUnits } from "@/lib/settings/use-measurement-units";
import { useBatchedSocialQuery, useSocialQuery } from "@/lib/social/use-social-query";
import { useDeviceReady } from "@/lib/use-device-ready";
import type { Coordinate, VenueRow } from "@/lib/venue/resolve";
import { useVenue } from "@/lib/venue/use-venue";
import { museumsInRegion, onVenueMetadataChange, regionAt } from "@/lib/venue/venue-db";
import { regionName } from "@/lib/venue/venue-location";
import { calendarDate } from "@/shared/journal/limits";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  catalogAsOf,
  catalogData,
  defaultCity,
  exploreCities,
  exploreData,
  namedRegions,
  withFriends,
  type FriendSaves,
} from "./catalog";
import type { ExploreCatalog, ExploreData } from "./types";

export type ExploreView<T = ExploreCatalog> = {
  status: "loading" | "offline" | "error" | "empty" | "ready";
  /** Set only while `status` is "ready". */
  data?: T;
  retry: () => void;
};

// The browsing city selection lasts for the app session.
let chosenCity: string | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Browses `cityId`, or follows the phone's location again without one. */
export function chooseCity(cityId: string | undefined) {
  chosenCity = cityId;
  for (const listener of listeners) listener();
}

const NO_FRIEND_SAVES: FriendSaves = [];

/** What the caller's friends want to see; only accounts have friends. */
function useFriendSaves(enabled: boolean): FriendSaves {
  const signedIn = useLocalOwner().startsWith("account:");
  const deviceReady = useDeviceReady();
  const args = enabled && signedIn && deviceReady ? {} : "skip";
  return useSocialQuery(api.wantToSee.friends, args, "explore").data ?? NO_FRIEND_SAVES;
}

function useCatalogContext({ friends = true } = {}) {
  const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
  const today = calendarDate(useCurrentMinute(), timeZone);
  const asOf = catalogAsOf(today);
  const offline = isOffline(useNetworkState());
  const { fix } = useVenue();
  const { units } = useMeasurementUnits();
  return { today, asOf, timeZone, offline, fix, units, friendSaves: useFriendSaves(friends) };
}

/** The phone's region from the venue table: undefined while it is read, null without a fix or a museum near it. */
function useHomeRegion(fix: Coordinate | undefined): string | null | undefined {
  const [region, setRegion] = useState<string | null>();
  useEffect(() => {
    if (!fix) return;
    let current = true;
    regionAt(fix).then(
      (found) => {
        if (current) setRegion(found ?? null);
      },
      (cause: unknown) => {
        reportError(cause, "explore.home.region");
        if (current) setRegion(null);
      },
    );
    return () => {
      current = false;
    };
  }, [fix]);
  return fix ? region : null;
}

const NO_MUSEUMS: VenueRow[] = [];

/** `ids` in slices of at most `size`, one per backend read. */
function inBatches<T>(ids: readonly T[], size: number): T[][] {
  const batches = [];
  for (let index = 0; index < ids.length; index += size) batches.push(ids.slice(index, index + size));
  return batches;
}

/** Local candidates appear only after the server confirms they are still discoverable in this region. */
function useCityMuseums(cityId: string | undefined) {
  const [read, setRead] = useState<{ cityId: string; museums: VenueRow[] }>();
  useEffect(() => {
    if (!cityId) return;
    let current = true;
    const refresh = () => {
      museumsInRegion(cityId).then(
        (museums) => {
          if (current) setRead({ cityId, museums });
        },
        (cause: unknown) => reportError(cause, "explore.city.museums"),
      );
    };
    refresh();
    const unsubscribe = onVenueMetadataChange(refresh);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [cityId]);
  const candidates = read && read.cityId === cityId ? read.museums : NO_MUSEUMS;
  const batches = cityId
    ? inBatches(candidates, 100).map((batch) => ({ region: cityId, museumIds: batch.map((museum) => museum.id) }))
    : [];
  const visibility = useBatchedSocialQuery(api.exhibitions.discoverableMuseumIds, batches, "explore");
  const allowed = new Set(visibility.data?.flat());
  return { ...visibility, museums: candidates.filter((museum) => allowed.has(museum.id)) };
}

/**
 * Browse the chosen city, else the phone's own, else the nearest city with shows to the phone or, without a location
 * fix, to its time zone, measured from today on this device.
 */
export function useExplore(): ExploreView<ExploreData> {
  const { today, asOf, timeZone, offline, fix, units, friendSaves } = useCatalogContext();
  const chosen = useSyncExternalStore(subscribe, () => chosenCity);
  const regions = useSocialQuery(api.exhibitions.regions, { asOf }, "explore");
  const home = useHomeRegion(fix);
  const listed = useMemo(() => namedRegions(regions.data ?? []), [regions.data]);
  const cities = useMemo(() => exploreCities(listed), [listed]);
  const picked = cities.some((city) => city.id === chosen) ? chosen : undefined;
  // Waits for the phone's region so Explore doesn't open one city and then jump to another.
  const cityId =
    picked ?? (home === undefined ? undefined : defaultCity(listed, { fix, home: home ?? undefined, timeZone }));
  const catalog = useSocialQuery(api.exhibitions.inRegion, !cityId ? "skip" : { region: cityId, asOf }, "explore");
  const cityMuseums = useCityMuseums(cityId);
  const city = cities.find((candidate) => candidate.id === cityId);
  const following = !picked && fix !== undefined;
  const data = useMemo(() => {
    if (!catalog.data || !city) return undefined;
    const place = {
      city,
      cities,
      nearby: city.id === home,
      following,
      home: home ? regionName(home) : undefined,
      today,
    };
    return withFriends(exploreData(catalog.data, cityMuseums.museums, place, fix, units), friendSaves);
  }, [catalog.data, cityMuseums.museums, city, cities, home, following, today, fix, units, friendSaves]);
  const retry = () =>
    regions.error ? regions.refresh() : cityMuseums.error ? cityMuseums.refresh() : catalog.refresh();
  if (offline && !data) return { status: "offline", retry };
  if (regions.error || catalog.error || cityMuseums.error) return { status: "error", retry };
  if (regions.data && listed.length === 0) return { status: "empty", retry };
  return data ? { status: "ready", data, retry } : { status: "loading", retry };
}

type Catalog = FunctionReturnType<typeof api.exhibitions.inRegion>;

function useCatalogView(
  result: { data?: Catalog; error?: Error; refresh: () => void },
  { today, offline, fix, units, friendSaves }: ReturnType<typeof useCatalogContext>,
): ExploreView {
  const data = useMemo(
    () => result.data && withFriends(catalogData(result.data, today, fix, units), friendSaves),
    [result.data, today, fix, units, friendSaves],
  );
  const retry = result.refresh;
  if (offline && !data) return { status: "offline", retry };
  if (result.error) return { status: "error", retry };
  return data ? { status: "ready", data, retry } : { status: "loading", retry };
}

/**
 * Saved shows and detail routes resolve by identity, including shows that have closed, independently of the browsing
 * city. `friends: false` leaves out who else wants to see them, for callers that never show it.
 */
export function useExhibitions(ids: readonly string[], { friends = true } = {}): ExploreView {
  const context = useCatalogContext({ friends });
  const batches = inBatches(ids as Id<"exhibitions">[], 100).map((exhibitionIds) => ({ exhibitionIds, asOf: 0 }));
  const result = useBatchedSocialQuery(api.exhibitions.byIds, batches, "explore");
  const data = useMemo(() => result.data && mergeCatalogs(result.data), [result.data]);
  return useCatalogView({ ...result, data }, context);
}

/** Saved museums with the shows on or ahead at each, independently of the browsing city. */
export function useMuseums(ids: readonly string[]): ExploreView {
  const context = useCatalogContext({ friends: false });
  const batches = inBatches(ids as Id<"museums">[], 20).map((museumIds) => ({ museumIds, asOf: context.asOf }));
  const result = useBatchedSocialQuery(api.exhibitions.atMuseums, batches, "explore");
  const data = useMemo(() => result.data && mergeCatalogs(result.data), [result.data]);
  return useCatalogView({ ...result, data }, context);
}

/** One catalog from batched reads, listing a museum that several batches return once. */
function mergeCatalogs(batches: Catalog[]): Catalog {
  return {
    museums: [
      ...new Map(batches.flatMap((batch) => batch.museums).map((museum) => [museum.museumId, museum])).values(),
    ],
    exhibitions: batches.flatMap((batch) => batch.exhibitions),
  };
}

export function useMuseum(museumId: string): ExploreView {
  const context = useCatalogContext();
  const result = useSocialQuery(
    api.exhibitions.atMuseum,
    { museumId: museumId as Id<"museums">, asOf: context.asOf },
    "explore",
  );
  return useCatalogView(result, context);
}

export const museumById = (data: ExploreCatalog, id: string) => data.museums.find((museum) => museum.id === id);
export const exhibitionById = (data: ExploreCatalog, id: string) =>
  data.exhibitions.find((exhibition) => exhibition.id === id);
