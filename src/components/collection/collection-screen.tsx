import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CanvasView } from './canvas-view';
import { GridView } from './grid-view';
import { ViewModePicker, type ViewMode } from './view-mode-picker';
import { VisitsView } from './visits-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import { listSavedWorks } from '@/db/repos/saved-works';
import { listVisits } from '@/db/repos/visits';
import { groupByVisit } from '@/lib/collection/group-by-visit';
import { filterWorks, sortWorksByArtist } from '@/lib/collection/search';
import { filterVisits, groupHistoryByMonth } from '@/lib/journal/history';
import { useVenueMetadata } from '@/lib/journal/use-venue-metadata';
import { searchTerm } from '@/lib/journal/query';

export function CollectionScreen() {
  const owner = useLocalOwner();
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<ViewMode>('grid');
  const { data: rows, updatedAt } = useLiveQuery(listSavedWorks(owner), [owner]);
  const { data: visits } = useLiveQuery(listVisits(owner), [owner]);
  const ownedVisits = visits.filter((visit) => visit.owner === owner);
  const metadata = useVenueMetadata([...ownedVisits.map((row) => row.venueId), ...rows.filter((row) => row.owner === owner).flatMap((row) => row.venueId ? [row.venueId] : [])], owner);
  const works = rows.filter((row) => row.owner === owner).map((row) => ({ ...row, city: row.venueId ? metadata.get(row.venueId)?.city : undefined }));
  const shown = filterWorks(works, search);
  const matchingVisits = filterVisits(ownedVisits.map((visit) => ({ ...visit,
    city: metadata.get(visit.venueId)?.city, country: metadata.get(visit.venueId)?.country,
  })), search);
  const visitIds = new Set(matchingVisits.map((visit) => visit.localId));
  const matchingWorks = new Set(shown.flatMap((work) => work.visitLocalId ? [work.visitLocalId] : []));
  const shownVisits = ownedVisits.filter((visit) => visitIds.has(visit.localId) || matchingWorks.has(visit.localId));
  const monthTitles = new Map(groupHistoryByMonth(shownVisits).map((group) => [group.data[0].localId, group.title]));
  const sections = groupByVisit(works.filter((work) => shown.includes(work) || work.visitLocalId && visitIds.has(work.visitLocalId)), shownVisits)
    .map((section) => ({ ...section, monthTitle: monthTitles.get(section.key) }));
  const header = <ViewModePicker mode={mode} onChange={setMode} />;

  return (
    <ThemedView style={styles.container}>
      <Stack.SearchBar
        placeholder={mode === 'visits' ? 'Museum, place or visit date' : 'Title, artist, date or place'}
        autoCapitalize="none"
        onChangeText={(event) => setSearch(event.nativeEvent.text)}
        onCancelButtonPress={() => setSearch('')}
      />
      {!updatedAt ? null : mode === 'visits' && sections.length ? (
        <VisitsView sections={sections} header={header} />
      ) : works.length === 0 && mode !== 'visits' ? (
        <Message header={header}>
          <ThemedText>Scan a painting to start your collection.</ThemedText>
          <Link href="/"><ThemedText type="linkPrimary">Go to Scan</ThemedText></Link>
        </Message>
      ) : mode === 'visits' && ownedVisits.length === 0 ? (
        <Message header={header}><ThemedText>Your museum visits will appear here, even when you save no artworks.</ThemedText></Message>
      ) : searchTerm(search) === null ? (
        <Message header={header}><ThemedText themeColor="textSecondary">Enter between 2 and 100 characters to search.</ThemedText></Message>
      ) : mode === 'visits' || shown.length === 0 ? (
        <Message header={header}><ThemedText themeColor="textSecondary">No {mode === 'visits' ? 'visits' : 'works'} match “{search.trim()}”.</ThemedText></Message>
      ) : mode === 'grid' ? (
        <GridView works={shown} header={header} />
      ) : mode === 'canvas' ? (
        <CanvasView works={shown} header={header} />
      ) : (
        <VisitsView sections={[{ key: 'az', title: 'A–Z by artist', data: sortWorksByArtist(shown) }]} header={header} />
      )}
    </ThemedView>
  );
}

function Message({ children, header }: { children: React.ReactNode; header: React.ReactElement }) {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic">
      {header}
      <View style={styles.message}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  message: { padding: Spacing.four, gap: Spacing.two, alignItems: 'center' },
});
