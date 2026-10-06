import { useMemo } from "react";

import { useCurrentMinute } from "@/hooks/use-current-minute";
import { calendarDate } from "@/shared/journal/limits";

import { sampleExplore } from "./sample-explore";
import type { ExploreData } from "./types";

/** Explore's shows and museums for a city (the first one when unset), measured from today on this device. */
export function useExplore(cityId?: string): ExploreData {
  const today = calendarDate(useCurrentMinute(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  return useMemo(() => sampleExplore(today, cityId), [today, cityId]);
}

export const museumById = (data: ExploreData, id: string) => data.museums.find((museum) => museum.id === id);
export const exhibitionById = (data: ExploreData, id: string) =>
  data.exhibitions.find((exhibition) => exhibition.id === id);
