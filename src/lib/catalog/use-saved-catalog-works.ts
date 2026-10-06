import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useEffect, useMemo } from "react";

import { listSavedCatalogWorks } from "@/db/repos/saved-works";
import type { SavedWork } from "@/db/schema";
import { useLocalOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";

/** This iPhone's newest save of each catalog artwork, keyed by artwork. */
export function useSavedCatalogWorks(): Map<string, SavedWork> {
  const owner = useLocalOwner();
  const { data, error } = useLiveQuery(listSavedCatalogWorks(owner), [owner]);
  useEffect(() => {
    if (error) reportError(error, "catalog.saved_works");
  }, [error]);
  return useMemo(() => {
    const saved = new Map<string, SavedWork>();
    for (const work of data) {
      if (work.owner === owner && work.artworkId && !saved.has(work.artworkId)) saved.set(work.artworkId, work);
    }
    return saved;
  }, [data, owner]);
}
