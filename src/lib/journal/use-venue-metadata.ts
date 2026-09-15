import { useEffect, useState } from 'react';
import { onVenueMetadataChange, venueMetadataForIds } from '../venue/venue-db';
import type { VenueRow } from '../venue/resolve';

/** `ready` is false until the rows for the current id set have been read, so screens can wait instead of rendering visits without places. */
export function useVenueMetadata(ids: string[], owner: string): { metadata: Map<string, VenueRow>; ready: boolean } {
  const key = JSON.stringify([...new Set(ids)].sort());
  const [state, setState] = useState<{ key: string; owner: string; rows: VenueRow[] }>();
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void venueMetadataForIds(JSON.parse(key)).then((rows) => {
        if (active) setState({ key, owner, rows });
      }).catch((error: unknown) => {
        console.warn('Could not read journal venue metadata', error);
        // Visits still render, without places, rather than loading forever.
        if (active) setState((current) => current?.key === key && current.owner === owner ? current : { key, owner, rows: [] });
      });
    };
    refresh();
    const unsubscribe = onVenueMetadataChange(refresh);
    return () => { active = false; unsubscribe(); };
  }, [key, owner]);
  const ready = state?.owner === owner && state.key === key;
  return { metadata: new Map(ready ? state.rows.map((row) => [row.id, row]) : []), ready };
}
