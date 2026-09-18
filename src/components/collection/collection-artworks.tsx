import { DEFAULT_THUMBNAIL_FRAME } from '@/shared/wall/defaults';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { FlatList, View, useWindowDimensions } from 'react-native';
import { ThemedText as Text } from '@/components/themed-text';
import { Gallery } from '@/constants/theme';
import type { useCollectionData } from '@/lib/collection/use-collection-data';
import { artistSections } from '@/lib/collection/artist-sections';
import { filterWorks } from '@/lib/collection/search';
import { useCollectionWall } from '@/lib/wall/use-collection-wall';
import { SocialState } from '../social/social-state';
import { SavedWorkImage } from './saved-work-image';
import { cropSyncing } from '@/lib/account/photo-sync';
import { WallFrame, wallFrameInset } from './wall-frame';
import { WorkLink } from './work-link';

type Work = ReturnType<typeof useCollectionData>['works'][number];
type Row = { key: string; kind: 'element'; element: ReactElement } | { key: string; kind: 'artist'; title: string } | { key: string; kind: 'work'; work: Work };

export function CollectionArtworks({ works, loading, error, search, header, controls, summary, onClearSearch, onRetry }: Pick<ReturnType<typeof useCollectionData>, 'works' | 'loading' | 'error'> & {
  search: string; header?: ReactElement; controls?: ReactElement; summary?: ReactElement; onClearSearch?: () => void; onRetry?: () => void;
}) {
  const wall = useCollectionWall(works);
  const { fontScale } = useWindowDimensions();
  // The hook owns the first read; returning from a detail screen, which edits the wall through its own repository, re-reads it.
  const loaded = useRef(false);
  useEffect(() => { loaded.current = !!wall.acknowledged; }, [wall.acknowledged]);
  useFocusEffect(useCallback(() => { if (wall.signedIn && loaded.current) void wall.refresh(); }, [wall.repository, wall.signedIn])); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = artistSections(filterWorks(works, search));
  const rows: Row[] = [];
  if (controls) rows.push({ key: 'controls', kind: 'element', element: controls });
  if (summary) rows.push({ key: 'summary', kind: 'element', element: summary });
  rows.push({ key: 'count', kind: 'element', element: <Text style={{ padding: 20, fontSize: 13, letterSpacing: 0.8, color: Gallery.muted }}>{works.length} ARTWORKS · BY ARTIST</Text> });
  for (const section of sections) {
    rows.push({ key: `artist:${section.key}`, kind: 'artist', title: section.title });
    for (const work of section.data) rows.push({ key: work.localId, kind: 'work', work });
  }
  const empty = sections.length ? undefined : <SocialState title={error ? 'Couldn’t load your collection.' : loading ? 'Opening collection…' : works.length ? 'No artworks found.' : 'Your collection begins here.'}
    detail={error ? 'Your saved collection is still on this iPhone. Try opening it again.' : loading ? undefined : works.length ? 'Try another title, artist, or place.' : 'Scan a painting to save your first artwork.'} loading={loading && !error}
    action={error ? onRetry ? 'Try again' : undefined : loading ? undefined : works.length ? 'Clear search' : 'Scan artwork'}
    onAction={error ? onRetry : works.length ? onClearSearch : () => router.push('/scan')} />;
  return <FlatList style={{ flex: 1, backgroundColor: Gallery.paper }} data={rows} keyExtractor={(row) => row.key}
    contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ paddingBottom: 28 }} ListHeaderComponent={header} ListFooterComponent={empty}
    stickyHeaderIndices={controls && fontScale < 1.6 ? [header ? 1 : 0] : undefined}
    renderItem={({ item }) => {
      if (item.kind === 'element') return item.element;
      if (item.kind === 'artist') return <Text variant="section" accessibilityRole="header" style={{ paddingHorizontal: 20, paddingVertical: 12, color: Gallery.ink }}>{item.title}</Text>;
      const { work } = item;
      const hung = wall.draft?.items.find((piece) => piece.saveLocalId === work.localId);
      const frame = hung?.layout.frame ?? DEFAULT_THUMBNAIL_FRAME;
      return <WorkLink work={work} style={{ flexDirection: 'row', gap: 14, alignItems: 'center', marginHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator }}>
        <View style={{ width: 56 }}><WallFrame frame={frame} width={56}><SavedWorkImage path={work.cropPath} syncing={cropSyncing(work)} title={work.title} contain style={{ width: 56 - 2 * wallFrameInset(frame, 56), height: 48 }} /></WallFrame>
          {hung && <Text accessibilityLabel="On your wall" style={{ position: 'absolute', right: -5, top: -7, overflow: 'hidden', borderRadius: 8, backgroundColor: Gallery.accent, color: Gallery.paper, fontSize: 13, paddingHorizontal: 3 }}>✓</Text>}</View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontSize: 17, lineHeight: 25, fontWeight: '600', color: Gallery.ink }}>{work.artist}</Text>
          <Text style={{ fontSize: 15, lineHeight: 22, color: Gallery.ink }}>{work.title}{work.date ? `, ${work.date}` : ''}</Text>
          <Text style={{ fontSize: 13, lineHeight: 18, color: Gallery.muted }}>{work.venueName ?? work.institution ?? 'Your collection'} · {new Date(work.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
          <Text style={{ fontSize: 13, color: Gallery.muted }}>{work.photoCount} {work.photoCount === 1 ? 'photo' : 'photos'} · {work.visitCount} {work.visitCount === 1 ? 'visit' : 'visits'}</Text>
        </View>
        <Text style={{ color: Gallery.muted }}>›</Text>
      </WorkLink>;
    }} />;
}
