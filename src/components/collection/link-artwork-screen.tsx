import { EmptyState, SearchEmptyState } from '../empty-state';
import { ArtworkCollage } from '../guest/artwork-preview';
import { VisitKeepsake } from '../guest/visit-keepsake';
import { ThemedText as Text } from '@/components/themed-text';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import type { SearchBarCommands } from 'react-native-screens';
import { FlatList, Pressable, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { linkArtworkVisit, selectArtworkEncounters } from '@/db/repos/artwork-album';
import { listSavedWorks } from '@/db/repos/saved-works';
import { listVisits } from '@/db/repos/visits';
import { useLocalOwner } from '@/lib/account/owner-store';
import { formatVisitDate } from '@/lib/journal/history';
import { normalizeSearch } from '@/shared/journal/limits';
import { showToast } from '@/lib/ui/toast';
import { GalleryButton } from './gallery-button';
import { SavedWorkImage } from './saved-work-image';
import { cropSyncing } from '@/lib/account/photo-sync';
import { SocialState } from '../social/social-state';
import { ListSkeleton } from '@/components/loading-skeleton';

export function LinkArtworkScreen() {
  const { savedId, visitId } = useLocalSearchParams<{ savedId?: string; visitId?: string }>();
  const owner = useLocalOwner();
  const [attempt, setAttempt] = useState(0);
  return <LinkPicker key={`${owner}:${savedId ?? ''}:${visitId ?? ''}:${attempt}`} owner={owner} savedId={savedId} visitId={visitId} onRetry={() => setAttempt((value) => value + 1)} />;
}

function LinkPicker({ owner, savedId, visitId, onRetry }: { owner: string; savedId?: string; visitId?: string; onRetry: () => void }) {
  const works = useLiveQuery(listSavedWorks(owner), [owner]);
  const visits = useLiveQuery(listVisits(owner), [owner]);
  const encounters = useLiveQuery(selectArtworkEncounters(owner), [owner]);
  const [error, setError] = useState<string>(), [search, setSearch] = useState('');
  const searchBar = useRef<SearchBarCommands>(null);
  const clearSearch = () => { searchBar.current?.clearText(); setSearch(''); };
  const rows = savedId ? visits.data.filter((row) => row.owner === owner).map((row) => ({ id: row.localId, title: row.venueName, subtitle: formatVisitDate(row.visitedOn), path: null, syncing: false }))
    : works.data.filter((row) => row.owner === owner).map((row) => ({ id: row.localId, title: row.title, subtitle: row.artist, path: row.cropPath, syncing: cropSyncing(row) }));
  const filtered = rows.filter((row) => normalizeSearch(`${row.title} ${row.subtitle}`).includes(normalizeSearch(search)));
  const query = savedId ? visits : works;
  if (!!savedId === !!visitId) return <View style={{ flex: 1, backgroundColor: Gallery.paper }}><SocialState title="Link unavailable." detail="Open an artwork or visit before linking." action="Go back" onAction={() => router.back()} /></View>;
  return <>
    <Stack.Screen options={{ title: savedId ? 'Link a visit' : 'Link an artwork' }} />
    <FlatList style={{ backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} data={filtered} keyExtractor={(row) => row.id}
      ListHeaderComponent={<View style={{ gap: 10, paddingVertical: 14 }}>
        {rows.length > 0 && <Text style={{ color: Gallery.muted, fontSize: 13, lineHeight: 20 }}>Keep the artwork and its photos together across visits. Linking doesn’t copy or share photos.</Text>}
        {savedId && rows.length > 0 && <GalleryButton label="Add a new visit" icon="plus" onPress={() => router.push({ pathname: '/visit-create', params: { savedId } })} />}
        {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
      </View>}
      renderItem={({ item: row }) => {
        const work = savedId ?? row.id, visit = visitId ?? row.id;
        const linked = encounters.data.some((entry) => entry.owner === owner && entry.savedLocalId === work && entry.visitLocalId === visit);
        return <Pressable accessibilityRole="button" accessibilityLabel={`${linked ? 'Linked: ' : 'Link '}${row.title}`} disabled={linked}
          onPress={() => {
            try { linkArtworkVisit(work, visit, owner); showToast('Artwork linked. Add photos from this visit separately.'); router.dismissTo({ pathname: '/saved/[savedId]', params: { savedId: work, visitId: visit } }); }
            catch { setError('Could not link this visit. Try again.'); }
          }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderColor: Gallery.separator }}>
          {!savedId && <SavedWorkImage path={row.path} syncing={row.syncing} title={row.title} contain style={{ width: 56, height: 56, borderRadius: 2 }} />}
          <View style={{ flex: 1, gap: 4 }}><Text style={{ fontSize: 17, lineHeight: 25, color: Gallery.ink }}>{row.title}</Text><Text style={{ fontSize: 13, color: Gallery.muted }}>{row.subtitle}{linked ? ' · Linked' : ''}</Text></View>
          <Text style={{ color: Gallery.muted }}>{linked ? '✓' : '›'}</Text>
        </Pressable>;
      }}
      ListEmptyComponent={query.error || encounters.error ? <SocialState title="Couldn’t load your collection." action="Try again" onAction={onRetry} />
        : !query.updatedAt && !rows.length ? <ListSkeleton label={savedId ? 'Loading visits…' : 'Loading artworks…'} />
        : search.trim() ? <SearchEmptyState title="No matches." detail={savedId ? 'Try a museum or visit date.' : 'Try another title or artist.'} onClear={clearSearch} />
          : <EmptyState inset={false} title={savedId ? 'No visits to link.' : 'No artworks to link.'}
            detail={savedId ? 'Add a museum visit, then link this artwork to it.' : 'Scan an artwork to save it to this visit.'} visual={savedId ? <VisitKeepsake /> : <ArtworkCollage />}>
            <GalleryButton label={savedId ? 'Add visit' : 'Scan artwork'} variant="filled" fullWidth onPress={() => {
              if (savedId) router.push({ pathname: '/visit-create', params: { savedId } });
              else { router.dismissAll(); router.navigate({ pathname: '/scan', params: { visitId } }); }
            }} />
            <GalleryButton label="Not now" fullWidth onPress={() => router.back()} />
          </EmptyState>} />
    {(rows.length > 0 || !!search.trim()) && <Stack.SearchBar ref={searchBar} placeholder={savedId ? 'Museum or visit date' : 'Title or artist'} hideWhenScrolling={false} autoCapitalize="none"
      onChangeText={(event) => setSearch(event.nativeEvent.text)} onCancelButtonPress={() => setSearch('')} />}
  </>;
}
