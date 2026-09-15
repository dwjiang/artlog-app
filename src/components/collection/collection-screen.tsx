import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Link, router, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CollectionWall } from './collection-wall';
import { GalleryButton } from './gallery-button';
import { GridView } from './grid-view';
import { ViewModePicker, type ViewMode } from './view-mode-picker';
import { VisitsView } from './visits-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Gallery, Spacing } from '@/constants/theme';
import { useLocalOwner, useOwnerGeneration } from '@/lib/account/owner-store';
import { listSavedWorks } from '@/db/repos/saved-works';
import { listVisits } from '@/db/repos/visits';
import { filterWorks, sortWorksByArtist } from '@/lib/collection/search';
import { visitSummaries } from '@/lib/journal/visit-summaries';
import { CollectionVisits } from '../visits/collection-visits';
import { useVenueMetadata } from '@/lib/journal/use-venue-metadata';
import { searchTerm } from '@/lib/journal/query';

export function CollectionScreen() {
  const owner = useLocalOwner();
  const [mode, setMode] = useState<ViewMode>('wall');
  return <OwnedCollection key={owner} mode={mode} setMode={setMode} />;
}

function OwnedCollection({ mode, setMode }: { mode: ViewMode; setMode: (mode: ViewMode) => void }) {
  const owner = useLocalOwner();
  const ownerGeneration = useOwnerGeneration();
  const [search, setSearch] = useState('');
  const { data: rows, updatedAt } = useLiveQuery(listSavedWorks(owner), [owner]);
  const { data: visits, updatedAt: visitsUpdatedAt, error: visitsError } = useLiveQuery(listVisits(owner), [owner]);
  const ownedVisits = visits.filter((visit) => visit.owner === owner);
  const { metadata, ready: metadataReady } = useVenueMetadata([...ownedVisits.map((row) => row.venueId), ...rows.filter((row) => row.owner === owner).flatMap((row) => row.venueId ? [row.venueId] : [])], owner);
  const works = rows.filter((row) => row.owner === owner).map((row) => ({ ...row, city: row.venueId ? metadata.get(row.venueId)?.city : undefined }));
  const shown = filterWorks(works, search);
  const summaries = visitSummaries(ownedVisits, works, metadata, owner);
  // The header search bar unmounts with the wall, so its text only needs clearing on that switch.
  function changeMode(value: ViewMode) { if (value === 'wall') setSearch(''); setMode(value); }
  const header = <View style={{ padding: mode === 'visits' ? 0 : Spacing.three, gap: Spacing.two }}>
    {mode !== 'visits' && <GalleryButton label="Back to wall" icon="chevron.left" onPress={() => changeMode('wall')} />}
    <ViewModePicker mode={mode} onChange={changeMode} />
  </View>;

  if (mode === 'wall') return <CollectionWall key={ownerGeneration} works={works} onModeChange={changeMode} />;

  return (
    <ThemedView style={[styles.container, { backgroundColor: Gallery.paper }]}>
      {mode === 'visits' && <Stack.Toolbar placement="left"><Stack.Toolbar.Button icon="person.crop.circle" hidesSharedBackground accessibilityLabel="Your account"
        onPress={() => router.push('/settings')}>Your account</Stack.Toolbar.Button></Stack.Toolbar>}
      <Stack.Toolbar placement="right"><Stack.Toolbar.Button hidesSharedBackground={mode === 'visits'} icon={mode === 'visits' ? undefined : 'plus'} accessibilityLabel="Add visit"
        style={{ fontSize: 15 }} onPress={() => router.push('/visit-create')}>Add visit</Stack.Toolbar.Button></Stack.Toolbar>
      {mode !== 'visits' && <Stack.SearchBar
        placeholder="Title, artist, date or place"
        autoCapitalize="none"
        onChangeText={(event) => setSearch(event.nativeEvent.text)}
        onCancelButtonPress={() => setSearch('')}
      />}
      {mode === 'visits' ? (
        <CollectionVisits key={owner} owner={owner} visits={summaries} search={search} header={header}
          loading={!updatedAt || !visitsUpdatedAt || !metadataReady} error={visitsError} clearSearch={() => setSearch('')} onSearchChange={setSearch} />
      ) : !updatedAt ? null : works.length === 0 ? (
        <Message header={header}>
          <ThemedText>Scan a painting to start your collection.</ThemedText>
          <Link href="/"><ThemedText type="linkPrimary">Go to Scan</ThemedText></Link>
        </Message>
      ) : searchTerm(search) === null ? (
        <Message header={header}><ThemedText themeColor="textSecondary">Enter between 2 and 100 characters to search.</ThemedText></Message>
      ) : shown.length === 0 ? (
        <Message header={header}><ThemedText themeColor="textSecondary">No works match “{search.trim()}”.</ThemedText></Message>
      ) : mode === 'grid' ? (
        <GridView works={shown} header={header} />
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
