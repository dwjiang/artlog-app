import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { FlatList, View } from 'react-native';
import { SocialText as Text } from '../social/social-text';
import { Gallery } from '@/constants/theme';
import type { useCollectionData } from '@/lib/collection/use-collection-data';
import { artistSections } from '@/lib/collection/artist-sections';
import { filterWorks } from '@/lib/collection/search';
import { useCollectionWall } from '@/lib/wall/use-collection-wall';
import { SocialState } from '../social/social-state';
import { SavedWorkImage } from './saved-work-image';
import { WallFrame, wallFrameInset } from './wall-frame';
import { WorkLink } from './work-link';

type Work = ReturnType<typeof useCollectionData>['works'][number];
type Row = { key: string; kind: 'element'; element: ReactElement } | { key: string; kind: 'artist'; title: string } | { key: string; kind: 'work'; work: Work };

export function CollectionArtworks({ works, loading, error, search, header, controls, summary }: Pick<ReturnType<typeof useCollectionData>, 'works' | 'loading' | 'error'> & {
  search: string; header?: ReactElement; controls?: ReactElement; summary?: ReactElement;
}) {
  const wall = useCollectionWall(works);
  // The hook owns the first read; returning from a detail screen, which edits the wall through its own repository, re-reads it.
  const loaded = useRef(false);
  useEffect(() => { loaded.current = !!wall.acknowledged; }, [wall.acknowledged]);
  useFocusEffect(useCallback(() => { if (wall.signedIn && loaded.current) void wall.refresh(); }, [wall.repository, wall.signedIn])); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = artistSections(filterWorks(works, search));
  const rows: Row[] = [];
  if (controls) rows.push({ key: 'controls', kind: 'element', element: controls });
  if (summary) rows.push({ key: 'summary', kind: 'element', element: summary });
  rows.push({ key: 'count', kind: 'element', element: <Text style={{ padding: 18, fontSize: 11, letterSpacing: 0.8, color: Gallery.muted }}>{works.length} ARTWORKS · BY ARTIST</Text> });
  for (const section of sections) {
    rows.push({ key: `artist:${section.key}`, kind: 'artist', title: section.title });
    for (const work of section.data) rows.push({ key: work.localId, kind: 'work', work });
  }
  const empty = sections.length ? undefined : <SocialState title={error ? 'Couldn’t load your collection.' : loading ? 'Opening collection…' : works.length ? 'No artworks found.' : 'Your collection begins here.'}
    detail={loading || error ? undefined : works.length ? 'Try another title, artist, or place.' : 'Scan a painting to save your first artwork.'} loading={loading} />;
  return <FlatList style={{ flex: 1, backgroundColor: Gallery.paper }} data={rows} keyExtractor={(row) => row.key}
    contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ paddingBottom: 28 }} ListHeaderComponent={header} ListFooterComponent={empty}
    stickyHeaderIndices={controls ? [header ? 1 : 0] : undefined}
    renderItem={({ item }) => {
      if (item.kind === 'element') return item.element;
      if (item.kind === 'artist') return <Text accessibilityRole="header" style={{ paddingHorizontal: 18, paddingVertical: 10, fontSize: 13, fontWeight: '600', color: Gallery.muted }}>{item.title}</Text>;
      const { work } = item;
      const hung = wall.draft?.items.find((piece) => piece.saveLocalId === work.localId);
      const frame = hung?.layout.frame ?? 'gilt';
      return <WorkLink work={work} style={{ flexDirection: 'row', gap: 14, alignItems: 'center', marginHorizontal: 18, paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator }}>
        <View style={{ width: 56 }}><WallFrame frame={frame} width={56}><SavedWorkImage path={work.cropPath} title={work.title} contain style={{ width: 56 - 2 * wallFrameInset(frame, 56), height: 48 }} /></WallFrame>
          {hung && <Text accessibilityLabel="On your wall" style={{ position: 'absolute', right: -5, top: -7, overflow: 'hidden', borderRadius: 8, backgroundColor: Gallery.accent, color: Gallery.paper, fontSize: 10, paddingHorizontal: 3 }}>✓</Text>}</View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: Gallery.ink }}>{work.artist}</Text>
          <Text style={{ fontSize: 13, fontStyle: 'italic', color: Gallery.ink }}>{work.title}{work.date ? `, ${work.date}` : ''}</Text>
          <Text style={{ fontSize: 10, lineHeight: 15, color: Gallery.muted }}>{work.venueName ?? work.institution ?? 'Your collection'} · {new Date(work.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
          <Text style={{ fontSize: 10, color: Gallery.muted }}>{work.photoCount} photos · {work.visitCount} visits</Text>
        </View>
        <Text style={{ color: Gallery.muted }}>›</Text>
      </WorkLink>;
    }} />;
}
