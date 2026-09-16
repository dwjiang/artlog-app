import { selectArtworkEncounters } from '@/db/repos/artwork-album';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { listVisits } from '@/db/repos/visits';
import { listSavedWorks } from '@/db/repos/saved-works';
import { useLocalOwner } from '../account/owner-store';
import { useVenueMetadata } from './use-venue-metadata';
import { visitSummaries } from './visit-summaries';

export function useVisits() {
  const owner = useLocalOwner();
  const encounters = useLiveQuery(selectArtworkEncounters(owner), [owner]);
  const visits = useLiveQuery(listVisits(owner), [owner]);
  const works = useLiveQuery(listSavedWorks(owner), [owner]);
  const { metadata, ready } = useVenueMetadata(visits.data.filter((visit) => visit.owner === owner).map((visit) => visit.venueId), owner);
  return { owner, visits: visitSummaries(visits.data, works.data, metadata, owner, encounters.data),
    loading: !visits.updatedAt || !works.updatedAt || !ready, error: visits.error ?? works.error };
}
