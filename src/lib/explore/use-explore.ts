import type { FunctionReturnType } from "convex/server";
import { useNetworkState } from "expo-network";
import { useMemo, useSyncExternalStore } from "react";

import { useCurrentMinute } from "@/hooks/use-current-minute";
import { isOffline } from "@/lib/network-state";
import { useMeasurementUnits } from "@/lib/settings/use-measurement-units";
import { useBatchedSocialQuery, useSocialQuery } from "@/lib/social/use-social-query";
import { useVenue } from "@/lib/venue/use-venue";
import { calendarDate } from "@/shared/journal/limits";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { catalogAsOf, catalogData, defaultCity, exploreCities, exploreData } from "./catalog";
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

export function chooseCity(cityId: string) {
  chosenCity = cityId;
  for (const listener of listeners) listener();
}

function useCatalogContext() {
  const today = calendarDate(useCurrentMinute(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  const asOf = catalogAsOf(today);
  const offline = isOffline(useNetworkState());
  const { fix } = useVenue();
  const { units } = useMeasurementUnits();
  return { today, asOf, offline, fix, units };
}

/** Browse the chosen city, or the one nearest the phone, measured from today on this device. */
export function useExplore(): ExploreView<ExploreData> {
  const { today, asOf, offline, fix, units } = useCatalogContext();
  const chosen = useSyncExternalStore(subscribe, () => chosenCity);
  const regions = useSocialQuery(api.exhibitions.regions, { asOf }, "explore");
  const cities = useMemo(() => exploreCities(regions.data ?? []), [regions.data]);
  const cityId = cities.some((city) => city.id === chosen) ? chosen : defaultCity(regions.data ?? [], fix);
  const catalog = useSocialQuery(api.exhibitions.inRegion, !cityId ? "skip" : { region: cityId, asOf }, "explore");
  const city = cities.find((candidate) => candidate.id === cityId);
  const data = useMemo(
    () => (catalog.data && city ? exploreData(catalog.data, { city, cities, today }, fix, units) : undefined),
    [catalog.data, city, cities, today, fix, units],
  );
  const retry = () => (regions.error ? regions.refresh() : catalog.refresh());
  if (offline && !data) return { status: "offline", retry };
  if (regions.error || catalog.error) return { status: "error", retry };
  if (regions.data?.length === 0) return { status: "empty", retry };
  return data ? { status: "ready", data, retry } : { status: "loading", retry };
}

type Catalog = FunctionReturnType<typeof api.exhibitions.inRegion>;

function useCatalogView(
  result: { data?: Catalog; error?: Error; refresh: () => void },
  { today, offline, fix, units }: ReturnType<typeof useCatalogContext>,
): ExploreView {
  const data = useMemo(
    () => result.data && catalogData(result.data, today, fix, units),
    [result.data, today, fix, units],
  );
  const retry = result.refresh;
  if (offline && !data) return { status: "offline", retry };
  if (result.error) return { status: "error", retry };
  return data ? { status: "ready", data, retry } : { status: "loading", retry };
}

/** Saved shows and detail routes resolve by identity, independently of the browsing city. */
export function useExhibitions(ids: readonly string[]): ExploreView {
  const context = useCatalogContext();
  const batches = [];
  for (let index = 0; index < ids.length; index += 100) {
    batches.push({ exhibitionIds: ids.slice(index, index + 100) as Id<"exhibitions">[], asOf: context.asOf });
  }
  const result = useBatchedSocialQuery(api.exhibitions.byIds, batches, "explore");
  const data = useMemo(
    () =>
      result.data && {
        museums: [
          ...new Map(result.data.flatMap((batch) => batch.museums).map((museum) => [museum.museumId, museum])).values(),
        ],
        exhibitions: result.data.flatMap((batch) => batch.exhibitions),
      },
    [result.data],
  );
  return useCatalogView({ ...result, data }, context);
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
