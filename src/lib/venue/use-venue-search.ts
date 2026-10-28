import { useEffect, useState } from "react";

import { reportError } from "@/lib/observability";

import { getPoiSearch } from "../../../modules/poi-search/src";
import type { Coordinate, VenueRow } from "./resolve";
import { searchVenues } from "./search-venues";
import { filterExcludedPlaces, openVenueDb } from "./venue-db";
import type { PoiOption } from "./venue-reducer";

/** Apple Maps is asked only when our table has nothing for the name; a short query would match too much of the world. */
export const PLACE_SEARCH_MIN = 3;

export type VenueSearch = {
  rows: VenueRow[];
  /** Apple Maps places, asked for only when the table has no match. */
  places: PoiOption[];
  failed?: "venues" | "places";
};

async function searchPlaces(query: string, near?: Coordinate): Promise<PoiOption[]> {
  if (query.trim().length < PLACE_SEARCH_MIN) return [];
  const places = await getPoiSearch().searchByName(query, near?.lat, near?.lng);
  return places.map((place) => ({
    kind: "poi",
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    category: place.category,
    ...(place.distanceMeters === undefined ? {} : { distanceM: place.distanceMeters }),
    city: place.city,
    country: place.country,
    ...(place.website ? { website: place.website } : {}),
    manual: true,
  }));
}

/**
 * Museums in the venue table matching `query`, searched once it has stayed for `delayMs`; with `places`, Apple Maps
 * answers when the table has none, searched around `near`. `result` is undefined until the search for the current
 * query answers, and always for a blank one; `latest` is the newest answer since the query was last blank or retried,
 * so results can stay on screen while the next query is searched.
 */
export function useVenueSearch(
  query: string,
  delayMs: number,
  places?: { near?: Coordinate },
): { result?: VenueSearch; latest?: VenueSearch & { query: string }; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<VenueSearch & { query: string; attempt: number }>();
  const blank = !query.trim();
  if (blank && answer) setAnswer(undefined);
  const withPlaces = !!places;
  const lat = places?.near?.lat;
  const lng = places?.near?.lng;
  useEffect(() => {
    if (blank) return;
    let active = true;
    const timer = setTimeout(() => {
      void searchVenues(query)
        .then(async (rows): Promise<VenueSearch> => {
          if (rows.length > 0 || !withPlaces) return { rows, places: [] };
          // Apple Maps is the fallback, so its failure is reported as its own rather than blamed on the table that answered.
          const near = lat === undefined || lng === undefined ? undefined : { lat, lng };
          return searchPlaces(query, near).then(
            async (found) => ({ rows, places: await filterExcludedPlaces(await openVenueDb(), found) }),
            (cause: unknown) => {
              reportError(cause, "venue.search.places");
              return { rows, places: [], failed: "places" };
            },
          );
        })
        .catch((cause: unknown): VenueSearch => {
          reportError(cause, "venue.search");
          return { rows: [], places: [], failed: "venues" };
        })
        .then((found) => {
          if (active) setAnswer({ query, attempt, ...found });
        });
    }, delayMs);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, attempt, blank, delayMs, withPlaces, lat, lng]);
  const current = !blank && answer?.query === query && answer.attempt === attempt ? answer : undefined;
  return {
    result: current,
    latest: answer,
    retry: () => {
      setAnswer(undefined);
      setAttempt((value) => value + 1);
    },
  };
}
