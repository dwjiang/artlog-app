import { useEffect, useState } from "react";

import { reportError } from "@/lib/observability";
import type { VenueRow } from "@/lib/venue/resolve";
import { onVenueMetadataChange, venueMetadataForIds } from "@/lib/venue/venue-db";

type Loaded = { owner: string; read: Set<string>; rows: Map<string, VenueRow> };

// Reads accumulate per owner, so an id that leaves and returns (delete, then Undo) stays ready instead of blanking the visits.
export function useVenueMetadata(ids: string[], owner: string): { metadata: Map<string, VenueRow>; ready: boolean } {
  const key = JSON.stringify([...new Set(ids)].sort());
  const [state, setState] = useState<Loaded>();
  useEffect(() => {
    let active = true;
    const requestedIds = JSON.parse(key) as string[];
    const merge = (current: Loaded | undefined, rows?: VenueRow[]): Loaded => {
      const base = current?.owner === owner ? current : { read: new Set<string>(), rows: new Map<string, VenueRow>() };
      const next = new Map(base.rows);
      if (rows) {
        for (const id of requestedIds) next.delete(id);
        for (const row of rows) next.set(row.id, row);
      }
      return {
        owner,
        read: new Set([...base.read, ...requestedIds]),
        rows: next,
      };
    };
    const refresh = () => {
      void venueMetadataForIds(requestedIds)
        .then((rows) => {
          if (active) setState((current) => merge(current, rows));
        })
        .catch((error: unknown) => {
          reportError(error, "journal.venue-metadata.load");
          // Visits still render, without places, rather than loading forever.
          if (active) setState((current) => merge(current));
        });
    };
    refresh();
    const unsubscribe = onVenueMetadataChange(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [key, owner]);
  const requested = [...new Set(ids)];
  const ready = state?.owner === owner && requested.every((id) => state.read.has(id));
  return {
    metadata: new Map(
      ready
        ? requested.flatMap((id) => {
            const row = state.rows.get(id);
            return row ? [[id, row] as const] : [];
          })
        : [],
    ),
    ready,
  };
}
