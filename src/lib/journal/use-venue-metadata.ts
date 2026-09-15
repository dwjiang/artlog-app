import { useEffect, useState } from 'react';
import { onVenueMetadataChange, venueMetadataForIds } from '../venue/venue-db';
import type { VenueRow } from '../venue/resolve';

export function useVenueMetadata(ids: string[], owner: string): Map<string, VenueRow> {
  const key = JSON.stringify([...new Set(ids)].sort());
  const [state, setState] = useState<{ key: string; owner: string; rows: VenueRow[] }>();
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void venueMetadataForIds(JSON.parse(key)).then((rows) => {
        if (active) setState({ key, owner, rows });
      }).catch((error: unknown) => console.warn('Could not read journal venue metadata', error));
    };
    refresh();
    const unsubscribe = onVenueMetadataChange(refresh);
    return () => { active = false; unsubscribe(); };
  }, [key, owner]);
  return new Map(state?.owner === owner && state.key === key ? state.rows.map((row) => [row.id, row]) : []);
}
