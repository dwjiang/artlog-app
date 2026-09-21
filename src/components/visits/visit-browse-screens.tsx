import { EmptyState, EmptySymbol } from '../empty-state';
import { GalleryButton } from '../collection/gallery-button';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';
import { useLocalOwner } from '@/lib/account/owner-store';
import { useVisits } from '@/lib/journal/use-visits';
import { visitsAtPlace } from '@/lib/journal/visit-summaries';
import { VisitGlobe } from './visit-globe';
import { VisitTimeline } from './visit-timeline';
import { VisitMessage, VisitPage } from './visit-ui';

export function VisitPlaceScreen() {
  const { placeKey, name, venueId } = useLocalSearchParams<{ placeKey: string; name: string; venueId?: string }>();
  const { visits, loading, error } = useVisits();
  const matches = visitsAtPlace(visits, placeKey).filter((visit) => !venueId || visit.venueId === venueId);
  return <><Stack.Screen options={{ title: name || 'Visits by museum' }} />
    {error || loading ? <VisitPage><VisitMessage loading={loading && !error} skeleton="list" action="Back to Collection" onAction={() => router.back()}>
      {error ? 'Visits could not load.' : 'Loading visits…'}
    </VisitMessage></VisitPage> : !matches.length ? <VisitPage><EmptyState inset={false} title="No visits here yet." detail="Your saved visits to this place will appear here." visual={<EmptySymbol name="building.columns" />}>
      <GalleryButton label="Back to Collection" onPress={() => router.back()} />
    </EmptyState></VisitPage> : <VisitTimeline visits={matches} groupByMuseum={!venueId} />}</>;
}
export function VisitGlobeScreen() {
  const owner = useLocalOwner();
  return <ExpandedGlobe key={owner} />;
}
function ExpandedGlobe() {
  const { venueId } = useLocalSearchParams<{ venueId?: string }>();
  const { visits, loading, error } = useVisits();
  return <><Stack.Toolbar placement="right"><Stack.Toolbar.Button onPress={() => router.back()}>Done</Stack.Toolbar.Button></Stack.Toolbar>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 30 }}>{loading || error ? <VisitMessage loading={loading && !error}>{error ? 'Globe locations could not load.' : 'Loading globe…'}</VisitMessage>
      : <VisitGlobe visits={visits} expanded initialVenueId={venueId} onList={() => router.back()} />}</ScrollView></>;
}
