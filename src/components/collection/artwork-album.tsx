import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gallery } from '@/constants/theme';
import { selectArtworkPhotos } from '@/db/repos/artwork-album';
import type { SavedWork } from '@/db/schema';
import { captureFileUri } from '@/lib/files/photos';
import { NativeSegmentedPicker } from './native-segmented-picker';
import { GalleryButton } from './gallery-button';
import { PhotoVisibility } from './photo-visibility';
import { WallFrame } from './wall-frame';
import { isLightWall } from '@/lib/wall/wall-layout';

export function ArtworkAlbum({ work, visitId, photoId, color = Gallery.accent }: { work: SavedWork; visitId?: string; photoId?: string; color?: string }) {
  const photos = useLiveQuery(selectArtworkPhotos(work.localId, work.owner), [work.localId, work.owner]);
  const [scope, setScope] = useState<'all' | 'visit'>(visitId ? 'visit' : 'all');
  const [requestedPhoto, setRequestedPhoto] = useState(photoId);
  const [page, setPage] = useState(0);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const gallery = useRef<ScrollView>(null);
  const width = useWindowDimensions().width;
  const ink = isLightWall(color) ? Gallery.ink : Gallery.paper;
  const rows = photos.data.filter((row) => row.owner === work.owner && row.savedLocalId === work.localId && (scope === 'all' || row.visitLocalId === visitId));
  const lastPage = Math.max(0, rows.length - 1);
  if (requestedPhoto && (photos.updatedAt || rows.length)) {
    setPage(Math.max(0, rows.findIndex((row) => row.localId === requestedPhoto)));
    setRequestedPhoto(undefined);
  } else if (page > lastPage) setPage(lastPage);
  return <View style={{ gap: 18 }}>
    {!!visitId && <NativeSegmentedPicker label="Photo scope" value={scope} onChange={(value) => { setScope(value); setPage(0); gallery.current?.scrollTo({ x: 0, animated: false }); }} options={[{ value: 'visit', label: 'This visit' }, { value: 'all', label: 'All photos' }]} />}
    {!rows.length && <Text style={styles.secondary}>{scope === 'visit' ? 'No photos from this visit yet. View all photos or add one.' : 'No photos yet. Add a photo to this artwork.'}</Text>}
    {!!rows.length && <View style={{ marginHorizontal: -20, backgroundColor: color, experimental_backgroundImage: 'linear-gradient(180deg, #ffffff1a 0%, transparent 24%, #00000017 100%)' }}>
    <ScrollView ref={gallery} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
      onContentSizeChange={() => gallery.current?.scrollTo({ x: Math.min(page, lastPage) * width, animated: false })}
      onMomentumScrollEnd={({ nativeEvent }) => setPage(Math.round(nativeEvent.contentOffset.x / width))}>
      {rows.map((photo, i) => <View key={photo.localId} style={{ width, gap: 10, paddingHorizontal: 20, paddingTop: 23, paddingBottom: 16, alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${photo.kind} photo ${i + 1}`} onPress={() => router.push({ pathname: '/photo-details', params: { savedId: work.localId, photoId: photo.localId } })} style={{ height: 285, justifyContent: 'center', alignItems: 'center' }}>
          <WallFrame frame="none" width={Math.min(width - 80, 265 * (ratios[photo.localId] || 1))}>
          {photo.path ? <Image source={{ uri: captureFileUri(photo.path) }} accessibilityLabel={`${photo.kind} photo ${i + 1} of ${work.title}`}
            onLoad={({ source }) => { if (source.width > 0 && source.height > 0) setRatios((previous) => ({ ...previous, [photo.localId]: source.width / source.height })); }}
            style={{ width: '100%', aspectRatio: ratios[photo.localId] || 1 }} contentFit="contain" /> : <Text style={styles.secondary}>Downloading photo…</Text>}
          </WallFrame>
        </Pressable>
        <Text style={[styles.secondary, { color: ink }]}>{photo.kind === 'full' ? 'Full painting' : photo.kind === 'detail' ? 'Detail' : 'Wall label'}{photo.caption ? ` · ${photo.caption}` : ''}</Text>
      </View>)}
    </ScrollView>
    <View style={[styles.row, { paddingHorizontal: 20, paddingBottom: 8 }]}><Text style={[styles.secondary, { color: ink }]}>{scope === 'visit' ? 'This visit' : 'Your photos'} · {rows.length} {rows.length === 1 ? 'photo' : 'photos'}</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous photo" disabled={page === 0} onPress={() => { const next = Math.max(0, page - 1); setPage(next); gallery.current?.scrollTo({ x: next * width, animated: true }); }} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: page === 0 ? 0.4 : 1 }}><Text style={{ color: ink, fontSize: 24 }}>‹</Text></Pressable>
        <Text style={[styles.secondary, { color: ink }]}>{Math.min(page + 1, rows.length)} / {rows.length}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next photo" disabled={page >= rows.length - 1} onPress={() => { const next = Math.min(rows.length - 1, page + 1); setPage(next); gallery.current?.scrollTo({ x: next * width, animated: true }); }} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: page >= rows.length - 1 ? 0.4 : 1 }}><Text style={{ color: ink, fontSize: 24 }}>›</Text></Pressable>
      </View>
    </View></View>}
    <View style={styles.row}><View style={{ flex: 1 }}>{rows[Math.min(page, rows.length - 1)] && <PhotoVisibility savedId={work.localId} photoId={rows[Math.min(page, rows.length - 1)].localId} />}</View>
      <GalleryButton label="Add photos" icon="photo.badge.plus" onPress={() => router.push({ pathname: '/add-photos', params: { draftId: `saved:${work.localId}`, savedId: work.localId, title: work.title, visitId } })} /></View>
    <View style={{ gap: 5 }}>
      <Text selectable style={{ color: Gallery.ink, fontSize: 19, lineHeight: 25, fontWeight: '600' }}>{work.artist || 'Artist unknown'}</Text>
      <Text selectable style={styles.title}>{work.title}{work.date ? `, ${work.date}` : ''}</Text>
      {!!work.medium && <Text selectable style={styles.secondary}>{work.medium}</Text>}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  secondary: { color: Gallery.muted, fontSize: 11, lineHeight: 17 },
  title: { fontStyle: 'italic', fontSize: 15, lineHeight: 22, color: Gallery.ink },
});
