import { useMemo } from "react";

import { useCurrentMinute } from "@/hooks/use-current-minute";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { calendarDate } from "@/shared/journal/limits";

import { api } from "../../../convex/_generated/api";
import { catalogData } from "./catalog";

/** Shows on now or ahead whose titles match `query`, timed from today on this device; a blank query skips the search. */
export function useExhibitionSearch(query: string) {
  const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
  const today = calendarDate(useCurrentMinute(), timeZone);
  const result = useSocialQuery(api.exhibitions.search, query.trim() ? { query, today } : "skip", "explore");
  const data = useMemo(
    () => result.data && catalogData(result.data, today, undefined, undefined),
    [result.data, today],
  );
  return { ...result, data, today };
}
