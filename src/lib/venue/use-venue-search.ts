import { useEffect, useState } from "react";

import { reportError } from "@/lib/observability";

import type { VenueRow } from "./resolve";
import { searchVenues } from "./search-venues";

export type VenueSearch = { rows: VenueRow[]; failed: boolean };

/**
 * Museums in the venue table matching `query`, searched once it has stayed for `delayMs`; undefined until the search
 * for the current query answers, and always for a blank one.
 */
export function useVenueSearch(query: string, delayMs: number): { result?: VenueSearch; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<VenueSearch & { query: string; attempt: number }>();
  const blank = !query.trim();
  useEffect(() => {
    if (blank) return;
    let active = true;
    const timer = setTimeout(() => {
      searchVenues(query).then(
        (rows) => {
          if (active) setAnswer({ query, attempt, rows, failed: false });
        },
        (cause: unknown) => {
          reportError(cause, "venue.search");
          if (active) setAnswer({ query, attempt, rows: [], failed: true });
        },
      );
    }, delayMs);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, attempt, blank, delayMs]);
  const current = !blank && answer?.query === query && answer.attempt === attempt ? answer : undefined;
  return { result: current, retry: () => setAttempt((value) => value + 1) };
}
