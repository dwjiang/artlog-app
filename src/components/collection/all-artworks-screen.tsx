import { useFocusEffect, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SectionList, View } from 'react-native';
import { SocialText as Text } from '../social/social-text';
import { Gallery } from '@/constants/theme';
import { useCollectionData } from '@/lib/collection/use-collection-data';
import { artistSections } from '@/lib/collection/artist-sections';
import { filterWorks } from '@/lib/collection/search';
import { useCollectionWall } from '@/lib/wall/use-collection-wall';
import { SocialState } from '../social/social-state';
import { SavedWorkImage } from './saved-work-image';
import { WallFrame, wallFrameInset } from './wall-frame';
import { WorkLink } from './work-link';

export function AllArtworksScreen() {
  const { works, loading, error } = useCollectionData();
  const wall = useCollectionWall(works);
  const [search, setSearch] = useState('');
  // The hook owns the first read; returning from a detail screen, which edits the wall through its own repository, re-reads it.
  const loaded = useRef(false);
  useEffect(() => { loaded.current = !!wall.acknowledged; }, [wall.acknowledged]);
  useFocusEffect(useCallback(() => { if (wall.signedIn && loaded.current) void wall.refresh(); }, [wall.repository, wall.signedIn])); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = artistSections(filterWorks(works, search));
  return <>
    <SectionList style={{ flex: 1, backgroundColor: Gallery.paper }} sections={sections} keyExtractor={(item) => item.localId}
      contentInsetAdjustmentBehavior="automatic" stickySectionHeadersEnabled={false} keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingBottom: 28 }}
      ListHeaderComponent={<Text style={{ padding: 18, fontSize: 11, letterSpacing: 0.8, color: Gallery.muted }}>{works.length} ARTWORKS · BY ARTIST</Text>}
      renderSectionHeader={({ section }) => <Text accessibilityRole="header" style={{ paddingHorizontal: 18, paddingVertical: 10, fontSize: 13, fontWeight: '600', color: Gallery.muted }}>{section.title}</Text>}
      renderItem={({ item }) => {
        const hung = wall.draft?.items.find((piece) => piece.saveLocalId === item.localId);
        const frame = hung?.layout.frame ?? 'gilt';
        return <WorkLink work={item} style={{ flexDirection: 'row', gap: 14, alignItems: 'center', marginHorizontal: 18, paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator }}>
          <View style={{ width: 56 }}><WallFrame frame={frame} width={56}><SavedWorkImage path={item.cropPath} title={item.title} contain style={{ width: 56 - 2 * wallFrameInset(frame, 56), height: 48 }} /></WallFrame>
            {hung && <Text accessibilityLabel="On your wall" style={{ position: 'absolute', right: -5, top: -7, overflow: 'hidden', borderRadius: 8, backgroundColor: Gallery.accent, color: Gallery.paper, fontSize: 10, paddingHorizontal: 3 }}>✓</Text>}</View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: Gallery.ink }}>{item.artist}</Text>
            <Text style={{ fontSize: 13, fontStyle: 'italic', color: Gallery.ink }}>{item.title}{item.date ? `, ${item.date}` : ''}</Text>
            <Text style={{ fontSize: 10, lineHeight: 15, color: Gallery.muted }}>{item.venueName ?? item.institution ?? 'Your collection'} · {new Date(item.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
            <Text style={{ fontSize: 10, color: Gallery.muted }}>{item.scanId ? 'Saved from Scan' : 'Saved artwork'}</Text>
          </View>
          <Text style={{ color: Gallery.muted }}>›</Text>
        </WorkLink>;
      }}
      ListEmptyComponent={<SocialState title={error ? 'Couldn’t load your collection.' : loading ? 'Opening collection…' : works.length ? 'No artworks found.' : 'Your collection begins here.'}
        detail={loading || error ? undefined : works.length ? 'Try another title, artist, or place.' : 'Scan a painting to save your first artwork.'} loading={loading} />} />
    <Stack.SearchBar placeholder="Title, artist, date or place" hideWhenScrolling={false} autoCapitalize="none" onChangeText={(event) => setSearch(event.nativeEvent.text)} onCancelButtonPress={() => setSearch('')} />
  </>;
}
