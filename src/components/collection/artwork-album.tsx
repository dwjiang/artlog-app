import { ThemedText as Text } from '@/components/themed-text';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gallery } from '@/constants/theme';
import { selectArtworkPhotos } from '@/db/repos/artwork-album';
import type { SavedWork } from '@/db/schema';
import { captureFileUri } from '@/lib/files/photos';
import { NativeSegmentedPicker } from './native-segmented-picker';

export function ArtworkAlbum({ work, visitId, photoId }: { work: SavedWork; visitId?: string; photoId?: string }) {
  const photos = useLiveQuery(selectArtworkPhotos(work.localId, work.owner), [work.localId, work.owner]);
  const [scope, setScope] = useState<'all' | 'visit'>(visitId ? 'visit' : 'all');
  const [requestedPhoto, setRequestedPhoto] = useState(photoId);
  const [page, setPage] = useState(0);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (active) setReduceMotion(enabled); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);
  const gallery = useRef<ScrollView>(null);
  const { width, fontScale } = useWindowDimensions();
  const rows = photos.data.filter((row) => row.owner === work.owner && row.savedLocalId === work.localId && (scope === 'all' || row.visitLocalId === visitId));
  const lastPage = Math.max(0, rows.length - 1);
  if (requestedPhoto && (photos.updatedAt || rows.length)) {
    setPage(Math.max(0, rows.findIndex((row) => row.localId === requestedPhoto)));
    setRequestedPhoto(undefined);
  } else if (page > lastPage) setPage(lastPage);
  const selectedPhoto = rows[Math.min(page, lastPage)];
  const imageHeight = selectedPhoto?.path && !failedPhotos[selectedPhoto.path]
    ? Math.max(44, (width - 40) / (ratios[selectedPhoto.localId] || 1)) : 180 * fontScale;
  const goTo = (next: number) => { setPage(next); gallery.current?.scrollTo({ x: next * width, animated: !reduceMotion }); };
  return <View style={{ gap: 16 }}>
    {!rows.length && <Text accessibilityRole={photos.error ? 'alert' : undefined} style={styles.secondary}>{photos.error ? 'Photos couldn’t load. Close and reopen this artwork to try again.'
      : !photos.updatedAt ? 'Loading photos…' : scope === 'visit' ? 'No photos from this visit yet. View all photos or add one.' : 'No photos yet. Add a photo to this artwork.'}</Text>}
    {!!rows.length && <View style={{ marginHorizontal: -20 }}>
    <ScrollView ref={gallery} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
      style={{ height: imageHeight }}
      onContentSizeChange={() => gallery.current?.scrollTo({ x: Math.min(page, lastPage) * width, animated: false })}
      onMomentumScrollEnd={({ nativeEvent }) => setPage(Math.round(nativeEvent.contentOffset.x / width))}>
      {rows.map((photo, i) => <View key={photo.localId} style={{ width, paddingHorizontal: 20 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${photo.kind} photo ${i + 1}`} onPress={() => router.push({ pathname: '/photo-details', params: { savedId: work.localId, photoId: photo.localId } })} style={{ height: imageHeight, justifyContent: 'center' }}>
          {photo.path && !failedPhotos[photo.path] ? <Image source={{ uri: captureFileUri(photo.path) }} accessibilityLabel={`${photo.kind} photo ${i + 1} of ${work.title}`}
            onError={() => setFailedPhotos((previous) => ({ ...previous, [photo.path!]: true }))}
            onLoad={({ source }) => { if (source.width > 0 && source.height > 0) setRatios((previous) => ({ ...previous, [photo.localId]: source.width / source.height })); }}
            style={{ width: '100%', height: '100%' }} contentFit="contain" /> : <View style={{ minHeight: 180, backgroundColor: Gallery.fill, padding: 16, justifyContent: 'center' }}><Text style={styles.secondary}>{photo.path ? `Image unavailable · ${work.title}` : `Photo unavailable on this iPhone · ${work.title}`}</Text></View>}
        </Pressable>
      </View>)}
    </ScrollView></View>}
    {(rows.length > 1 || !!selectedPhoto?.caption || !!visitId) && <View style={styles.row}>
      <Text selectable style={[styles.secondary, { flexShrink: 1 }]}>{selectedPhoto?.caption ?? ''}</Text>
      {rows.length > 1 && <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous photo" disabled={page === 0} onPress={() => goTo(Math.max(0, page - 1))} style={[styles.arrow, page === 0 && { opacity: 0.4 }]}><Text style={styles.arrowText}>‹</Text></Pressable>
        <Text style={[styles.secondary, { fontVariant: ['tabular-nums'] }]}>{Math.min(page + 1, rows.length)} / {rows.length}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next photo" disabled={page >= rows.length - 1} onPress={() => goTo(Math.min(rows.length - 1, page + 1))} style={[styles.arrow, page >= rows.length - 1 && { opacity: 0.4 }]}><Text style={styles.arrowText}>›</Text></Pressable>
      </View>}
    </View>}
    {!!visitId && <NativeSegmentedPicker label="Photo scope" value={scope} onChange={(value) => { setScope(value); setPage(0); gallery.current?.scrollTo({ x: 0, animated: false }); }} options={[{ value: 'visit', label: 'This visit' }, { value: 'all', label: 'All photos' }]} />}
    <View style={{ gap: 4 }}>
      <Text variant="display" accessibilityRole="header" selectable style={{ color: Gallery.ink }}>{work.artist || 'Artist unknown'}</Text>
      <Text selectable style={styles.title}>{work.title}{work.date ? `, ${work.date}` : ''}</Text>
      {!!work.medium && <Text selectable style={styles.medium}>{work.medium}</Text>}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  secondary: { color: Gallery.muted, fontSize: 13, lineHeight: 18 },
  arrow: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  arrowText: { color: Gallery.ink, fontSize: 24 },
  title: { fontSize: 20, lineHeight: 26, color: Gallery.ink },
  medium: { fontSize: 15, lineHeight: 22, color: Gallery.muted },
});
