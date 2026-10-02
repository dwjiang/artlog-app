import { useQueries, type RequestForQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { listSavedArtworkIds } from "@/db/repos/saved-works";
import { useLocalOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";
import { useDeviceReady } from "@/lib/use-device-ready";
import { calendarDate } from "@/shared/journal/limits";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export type MuseumPick = FunctionReturnType<typeof api.museumPicks.forVenue>[number];

const currentDay = () => calendarDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone);

function useCurrentDay() {
  const [day, setDay] = useState(currentDay);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      setDay(currentDay());
      const midnight = new Date(Date.now());
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(refresh, Math.max(1, midnight.getTime() - Date.now()));
    };
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
      else clearTimeout(timer);
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);
  return day;
}

function usePicksQuery(venueId: string | undefined, artworkId?: string) {
  const ready = useDeviceReady();
  const day = useCurrentDay();
  const queries = useMemo(
    (): RequestForQueries =>
      ready && venueId
        ? {
            picks: {
              query: api.museumPicks.forVenue,
              args: { venueId, day, ...(artworkId ? { artworkId: artworkId as Id<"artworks"> } : {}) },
            },
          }
        : {},
    [ready, venueId, day, artworkId],
  );
  const { picks }: { picks?: MuseumPick[] | Error } = useQueries(queries);
  useEffect(() => {
    if (picks instanceof Error) reportError(picks, "venue.picks.load");
  }, [picks]);
  return {
    picks: Array.isArray(picks) ? picks : [],
    loading: !!venueId && picks === undefined,
    error: picks instanceof Error,
  };
}

/** Home's "Don't miss" for a museum, leaving out works this person already saved. Empty while loading or offline. */
export function useMuseumPicks(venueId: string | undefined): MuseumPick[] {
  const owner = useLocalOwner();
  const { picks } = usePicksQuery(venueId);
  const saved = useLiveQuery(listSavedArtworkIds(owner), [owner]);
  useEffect(() => {
    if (saved.error) reportError(saved.error, "venue.picks.saved");
  }, [saved.error]);
  const kept = new Set(saved.data.map((row) => row.artworkId));
  return picks.filter((pick) => !kept.has(pick.artworkId));
}

export function useMuseumPick(venueId: string | undefined, artworkId: string | undefined) {
  const { picks, loading, error } = usePicksQuery(artworkId ? venueId : undefined, artworkId);
  return { pick: picks.find((candidate) => candidate.artworkId === artworkId), loading, error };
}
