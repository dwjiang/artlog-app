import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

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
import { filterWorks } from '@/lib/collection/search';

export function CollectionScreen() {
  const owner = useLocalOwner();
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<ViewMode>('grid');
  const { data: rows, updatedAt } = useLiveQuery(listSavedWorks({}, owner), [owner]);
  const { data: visits } = useLiveQuery(listVisits(owner), [owner]);
  const works = rows.filter((row) => row.owner === owner);
  const shown = filterWorks(works, search);
  const header = <ViewModePicker mode={mode} onChange={setMode} />;

  return (
    <ThemedView style={styles.container}>
      <Stack.SearchBar
        placeholder="Title, artist or museum"
        autoCapitalize="none"
        onChangeText={(event) => setSearch(event.nativeEvent.text)}
        onCancelButtonPress={() => setSearch('')}
      />
      {!updatedAt ? null : works.length === 0 ? (
        <Message>
          <ThemedText>Scan a painting to start your collection.</ThemedText>
          <Link href="/"><ThemedText type="linkPrimary">Go to Scan</ThemedText></Link>
        </Message>
      ) : shown.length === 0 ? (
        <Message><ThemedText themeColor="textSecondary">No works match “{search.trim()}”.</ThemedText></Message>
      ) : mode === 'grid' ? (
        <GridView works={shown} header={header} />
      ) : mode === 'canvas' ? (
        <CanvasView works={shown} header={header} />
      ) : (
        <VisitsView sections={groupByVisit(shown, visits.filter((visit) => visit.owner === owner))} header={header} />
      )}
    </ThemedView>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.message}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  message: { padding: Spacing.four, gap: Spacing.two, alignItems: 'center' },
});
