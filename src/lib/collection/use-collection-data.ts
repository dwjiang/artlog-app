import { usePendingRemovals } from './pending-removals';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { listSavedWorks } from '@/db/repos/saved-works';
import { listVisits } from '@/db/repos/visits';
import { useLocalOwner } from '../account/owner-store';
import { useVenueMetadata } from '../journal/use-venue-metadata';
import { visitSummaries } from '../journal/visit-summaries';

export function useCollectionData() {
  const owner = useLocalOwner();
  const removals = usePendingRemovals();
  const worksQuery = useLiveQuery(listSavedWorks(owner, true), [owner]);
  const visitsQuery = useLiveQuery(listVisits(owner), [owner]);
  const hiddenIds = [...new Set([
    ...worksQuery.data.filter((row) => row.owner === owner && row.deletedAt !== null).map((row) => row.localId),
    ...removals.filter((item) => item.owner === owner && item.status !== 'failed').map((item) => item.localId),
  ])];
  const rows = worksQuery.data.filter((row) => row.owner === owner && !hiddenIds.includes(row.localId));
  const visits = visitsQuery.data.filter((row) => row.owner === owner);
  const { metadata, ready } = useVenueMetadata([...visits.map((row) => row.venueId), ...rows.flatMap((row) => row.venueId ? [row.venueId] : [])], owner);
  const works = rows.map((row) => ({ ...row, city: row.venueId ? metadata.get(row.venueId)?.city : undefined }));
  return { owner, works, hiddenIds, visits: visitSummaries(visits, works, metadata, owner),
    loading: !worksQuery.updatedAt || !visitsQuery.updatedAt || !ready, error: worksQuery.error ?? visitsQuery.error };
}
