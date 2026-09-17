import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { linkArtworkVisit, selectArtworkEncounters } from '@/db/repos/artwork-album';
import { listSavedWorks } from '@/db/repos/saved-works';
import { listVisits } from '@/db/repos/visits';
import { useLocalOwner } from '@/lib/account/owner-store';
import { formatVisitDate } from '@/lib/journal/history';
import { normalizeSearch } from '@/shared/journal/limits';
import { GalleryButton } from './gallery-button';
import { SavedWorkImage } from './saved-work-image';

export function LinkArtworkScreen() {
  const { savedId, visitId } = useLocalSearchParams<{ savedId?: string; visitId?: string }>();
  const owner = useLocalOwner();
  return <LinkPicker key={`${owner}:${savedId ?? ''}:${visitId ?? ''}`} owner={owner} savedId={savedId} visitId={visitId} />;
}

function LinkPicker({ owner, savedId, visitId }: { owner: string; savedId?: string; visitId?: string }) {
  const works = useLiveQuery(listSavedWorks(owner), [owner]);
  const visits = useLiveQuery(listVisits(owner), [owner]);
  const encounters = useLiveQuery(selectArtworkEncounters(owner), [owner]);
  const [error, setError] = useState<string>(), [search, setSearch] = useState('');
  const rows = savedId ? visits.data.filter((row) => row.owner === owner).map((row) => ({ id: row.localId, title: row.venueName, subtitle: formatVisitDate(row.visitedOn), path: null }))
    : works.data.filter((row) => row.owner === owner).map((row) => ({ id: row.localId, title: row.title, subtitle: row.artist, path: row.cropPath }));
  const filtered = rows.filter((row) => normalizeSearch(`${row.title} ${row.subtitle}`).includes(normalizeSearch(search)));
  if (!!savedId === !!visitId) return <Text style={{ padding: 20, color: Gallery.muted }}>Open an artwork or visit before linking.</Text>;
  return <>
    <Stack.Screen options={{ title: savedId ? 'Link a visit' : 'Link an artwork' }} />
    <FlatList style={{ backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} data={filtered} keyExtractor={(row) => row.id}
      ListHeaderComponent={<View style={{ gap: 10, paddingVertical: 14 }}>
        <Text style={{ color: Gallery.muted, fontSize: 13, lineHeight: 20 }}>Keep the artwork and its photos together across visits. Linking doesn’t copy or share photos.</Text>
        {savedId && <GalleryButton label="Add a new visit" icon="plus" onPress={() => router.push({ pathname: '/visit-create', params: { savedId } })} />}
        {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
      </View>}
      renderItem={({ item: row }) => {
        const work = savedId ?? row.id, visit = visitId ?? row.id;
        const linked = encounters.data.some((entry) => entry.owner === owner && entry.savedLocalId === work && entry.visitLocalId === visit);
        return <Pressable accessibilityRole="button" accessibilityLabel={`${linked ? 'Linked: ' : 'Link '}${row.title}`} disabled={linked}
          onPress={() => {
            try { linkArtworkVisit(work, visit, owner); router.dismissTo({ pathname: '/[savedId]', params: { savedId: work, visitId: visit } }); }
            catch { setError('Could not link this visit. Try again.'); }
          }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderColor: Gallery.separator, opacity: linked ? 0.6 : 1 }}>
          {!savedId && <SavedWorkImage path={row.path} title={row.title} contain style={{ width: 56, height: 56, borderRadius: 4 }} />}
          <View style={{ flex: 1, gap: 4 }}><Text style={{ fontSize: 14, color: Gallery.ink }}>{row.title}</Text><Text style={{ fontSize: 12, color: Gallery.muted }}>{row.subtitle}{linked ? ' · Linked' : ''}</Text></View>
          <Text style={{ color: Gallery.muted }}>{linked ? '✓' : '›'}</Text>
        </Pressable>;
      }}
      ListEmptyComponent={<Text style={{ paddingVertical: 24, color: Gallery.muted }}>{search ? 'No matches. Try another name.' : savedId ? 'Add a visit to link this artwork.' : 'Save an artwork before linking it to this visit.'}</Text>} />
    <Stack.SearchBar placeholder={savedId ? 'Museum or visit date' : 'Title or artist'} hideWhenScrolling={false} autoCapitalize="none"
      onChangeText={(event) => setSearch(event.nativeEvent.text)} onCancelButtonPress={() => setSearch('')} />
  </>;
}
