import { SearchEmptyState } from '../empty-state';
import { DEFAULT_THUMBNAIL_FRAME } from '@/shared/wall/defaults';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { ListSkeleton } from '@/components/loading-skeleton';
import { ChoiceMenu } from '../choice-menu';
import { CollectionEmptyState } from '../guest/collection-empty-state';

type Work = ReturnType<typeof useCollectionData>['works'][number];
type Row = { key: string; kind: 'element'; element: ReactElement } | { key: string; kind: 'artist'; title: string } | { key: string; kind: 'work'; work: Work };

export function CollectionArtworks({ works, loading, error, search, header, controls, onClearSearch, onRetry }: Pick<ReturnType<typeof useCollectionData>, 'works' | 'loading' | 'error'> & {
  search: string; header?: ReactElement; controls?: ReactElement; onClearSearch?: () => void; onRetry?: () => void;
}) {
  const wall = useCollectionWall(works);
  const { fontScale, width } = useWindowDimensions();
  const [sort, setSort] = useState<'recent' | 'artist'>('recent');
  // The hook owns the first read; returning from a detail screen, which edits the wall through its own repository, re-reads it.
  const loaded = useRef(false);
  useEffect(() => { loaded.current = !!wall.acknowledged; }, [wall.acknowledged]);
  useFocusEffect(useCallback(() => { if (wall.signedIn && loaded.current) void wall.refresh(); }, [wall.repository, wall.signedIn])); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = filterWorks(works, search);
  const rows: Row[] = [];
  if (controls) rows.push({ key: 'controls', kind: 'element', element: controls });
  const initialLoading = loading && !error && !works.length;
  if (!initialLoading && works.length > 0) rows.push({ key: 'count', kind: 'element', element: <View style={{ paddingHorizontal: 20, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
    <Text variant="metadata" themeColor="textSecondary" style={{ flex: 1 }}>{filtered.length} {filtered.length === 1 ? 'artwork' : 'artworks'}</Text>
    <View style={{ minWidth: 96 }}><ChoiceMenu plain label="Sort artworks" value={sort} onChange={setSort} options={[{ value: 'recent', label: 'Recent' }, { value: 'artist', label: 'Artist' }]} /></View>
  </View> });
  if (sort === 'artist') {
    for (const section of artistSections(filtered)) {
      rows.push({ key: `artist:${section.key}`, kind: 'artist', title: section.title });
      for (const work of section.data) rows.push({ key: work.localId, kind: 'work', work });
    }
  } else {
    for (const work of [...filtered].sort((a, b) => b.savedAt - a.savedAt || a.localId.localeCompare(b.localId))) rows.push({ key: work.localId, kind: 'work', work });
  }
  const empty = initialLoading ? <ListSkeleton label="Opening collection…" rows={5} /> : filtered.length ? undefined
    : error ? <SocialState title="Couldn’t load your collection." detail="Your saved collection is still on this iPhone. Try opening it again." action={onRetry ? 'Try again' : undefined} onAction={onRetry} />
      : search.trim() ? <SearchEmptyState title="No artworks found." detail="Try another title, artist, or place." onClear={() => onClearSearch?.()} />
        : <CollectionEmptyState kind="artworks" />;
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
      const imageWidth = Math.max(1, width - 40);
      return <WorkLink work={work} style={{ gap: 8, marginHorizontal: 20, paddingBottom: 12, marginBottom: 12, borderBottomWidth: 0.5, borderBottomColor: Gallery.separator }}>
        <WallFrame frame={frame} width={imageWidth}><SavedWorkImage path={work.cropPath} syncing={cropSyncing(work)} title={work.title} style={{ width: imageWidth - 2 * wallFrameInset(frame, imageWidth), height: imageWidth * 0.56 }} /></WallFrame>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 1 }}>
            <Text variant="secondary" style={{ fontWeight: '700', lineHeight: 18 }}>{work.artist}</Text>
            <Text variant="secondary">{work.title}{work.date ? `, ${work.date}` : ''}</Text>
            <Text variant="metadata" themeColor="textSecondary">{work.venueName ?? work.institution ?? 'Your collection'} · {new Date(work.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
            <Text variant="metadata" themeColor="textSecondary">{work.photoCount} {work.photoCount === 1 ? 'photo' : 'photos'} · {work.visitCount} {work.visitCount === 1 ? 'visit' : 'visits'}{hung ? ' · On your wall' : ''}</Text>
          </View>
          <Text style={{ color: Gallery.muted }} accessible={false}>›</Text>
        </View>
      </WorkLink>;
    }} />;
}
