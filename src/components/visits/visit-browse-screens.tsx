import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';
import { useLocalOwner } from '@/lib/account/owner-store';
import { useVisits } from '@/lib/journal/use-visits';
import { visitsAtPlace } from '@/lib/journal/visit-summaries';
import { VisitGlobe } from './visit-globe';
import { VisitTimeline } from './visit-timeline';
import { VisitMessage, VisitPage } from './visit-ui';

export function VisitPlaceScreen() {
  const { placeKey, name } = useLocalSearchParams<{ placeKey: string; name: string }>();
  const { visits, loading, error } = useVisits();
  const matches = visitsAtPlace(visits, placeKey);
  return <><Stack.Screen options={{ title: name || 'Visits by museum' }} />
    {error || !matches.length ? <VisitPage><VisitMessage loading={loading && !error} skeleton="list" action="Back to Collection" onAction={() => router.back()}>
      {error ? 'Visits could not load.' : loading ? 'Loading visits…' : 'No visits are available here.'}
    </VisitMessage></VisitPage> : <VisitTimeline visits={matches} groupByMuseum />}</>;
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
