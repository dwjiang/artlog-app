import { EmptyState, EmptySymbol } from '../empty-state';
import { GalleryButton } from './gallery-button';
import { ThemedText as Text } from '@/components/themed-text';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gallery } from '@/constants/theme';
import { selectArtworkPhotos } from '@/db/repos/artwork-album';
import type { SavedWork } from '@/db/schema';
import { captureFileUri } from '@/lib/files/photos';
import { NativeSegmentedPicker } from './native-segmented-picker';
import { ImageSkeleton } from '@/components/loading-skeleton';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

export function ArtworkAlbum({ work, visitId, photoId }: { work: SavedWork; visitId?: string; photoId?: string }) {
  const photos = useLiveQuery(selectArtworkPhotos(work.localId, work.owner), [work.localId, work.owner]);
  const [scope, setScope] = useState<'all' | 'visit'>(visitId ? 'visit' : 'all');
  const [requestedPhoto, setRequestedPhoto] = useState(photoId);
  const [page, setPage] = useState(0);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});
  const reduceMotion = useReducedMotion();
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
    ? Math.max(44, Math.min((width - 40) * 1.2, (width - 40) / (ratios[selectedPhoto.localId] || 1))) : 180 * fontScale;
  const goTo = (next: number) => { setPage(next); gallery.current?.scrollTo({ x: next * width, animated: !reduceMotion }); };
  return <View style={{ gap: 8 }}>
    {!rows.length && !photos.updatedAt && !photos.error ? <ImageSkeleton label="Loading photos…" style={{ width: '100%', aspectRatio: 1 }} />
      : !rows.length && (photos.error ? <Text accessibilityRole="alert" style={styles.secondary}>Photos couldn’t load. Close and reopen this artwork to try again.</Text>
        : <View style={{ minHeight: 160, backgroundColor: Gallery.fill, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}><EmptySymbol name="photo" /></View>)}
    {!!rows.length && <View style={{ marginHorizontal: -20 }}>
    <ScrollView ref={gallery} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
      style={{ height: imageHeight }}
      onContentSizeChange={() => gallery.current?.scrollTo({ x: Math.min(page, lastPage) * width, animated: false })}
      onMomentumScrollEnd={({ nativeEvent }) => setPage(Math.round(nativeEvent.contentOffset.x / width))}>
      {rows.map((photo, i) => <View key={photo.localId} style={{ width, paddingHorizontal: 20 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${photo.kind} photo ${i + 1}`} onPress={() => router.push({ pathname: '/photo-details', params: { savedId: work.localId, photoId: photo.localId } })} style={{ height: imageHeight, padding: 16, backgroundColor: Gallery.fill, justifyContent: 'center' }}>
          {photo.path && !failedPhotos[photo.path] ? <Image source={{ uri: captureFileUri(photo.path) }} accessibilityLabel={`${photo.kind} photo ${i + 1} of ${work.title}`}
            onError={() => setFailedPhotos((previous) => ({ ...previous, [photo.path!]: true }))}
            onLoad={({ source }) => { if (source.width > 0 && source.height > 0) setRatios((previous) => ({ ...previous, [photo.localId]: source.width / source.height })); }}
            style={{ width: '100%', height: '100%' }} contentFit="contain" /> : <View style={{ minHeight: 180, backgroundColor: Gallery.fill, padding: 16, justifyContent: 'center' }}><Text style={styles.secondary}>{photo.path ? `Image unavailable · ${work.title}` : `Photo unavailable on this iPhone · ${work.title}`}</Text></View>}
        </Pressable>
      </View>)}
    </ScrollView></View>}
    <View style={{ gap: 4 }}>
      <Text variant="display" accessibilityRole="header" selectable style={{ color: Gallery.ink, fontSize: 40, lineHeight: 46 }}>{work.title}</Text>
      <Text selectable style={styles.title}>{work.artist || 'Artist unknown'}{work.date ? `, ${work.date}` : ''}</Text>
      {(work.medium || work.institution || work.venueName) && <Text selectable style={styles.medium}>{[work.medium, work.institution || work.venueName].filter(Boolean).join(' · ')}</Text>}
    </View>
    {rows.length > 1 && <View style={styles.thumbnails}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
        {rows.map((photo, index) => <Pressable key={photo.localId} accessibilityRole="button" accessibilityLabel={`Show ${photo.kind} photo ${index + 1}`}
          accessibilityState={{ selected: index === page }} onPress={() => goTo(index)} style={[styles.thumbnail, index === page && { borderColor: Gallery.accent }]}>
          {photo.path && !failedPhotos[photo.path] ? <Image source={{ uri: captureFileUri(photo.path) }} contentFit="cover" style={{ width: '100%', height: '100%' }} />
            : <Image source="sf:photo" tintColor={Gallery.muted} style={{ width: 22, height: 22 }} />}
        </Pressable>)}
      </ScrollView>
      <GalleryButton label="Photo" accessibilityLabel="Add photos" icon="plus" onPress={() => router.push({ pathname: '/add-photos', params: { draftId: `saved:${work.localId}`, savedId: work.localId, title: work.title, visitId } })} />
    </View>}
    {rows.length === 1 && <GalleryButton label="Photo" accessibilityLabel="Add photos" icon="plus" onPress={() => router.push({ pathname: '/add-photos', params: { draftId: `saved:${work.localId}`, savedId: work.localId, title: work.title, visitId } })} />}
    {!!selectedPhoto?.caption && <Text selectable style={styles.secondary}>{selectedPhoto.caption}</Text>}
    {!!visitId && <NativeSegmentedPicker label="Photo scope" value={scope} onChange={(value) => { setScope(value); setPage(0); gallery.current?.scrollTo({ x: 0, animated: false }); }} options={[{ value: 'visit', label: 'This visit' }, { value: 'all', label: 'All photos' }]} />}
    {!rows.length && !!photos.updatedAt && !photos.error && <EmptyState inset={false} title={scope === 'visit' ? 'No photos from this visit yet.' : 'Keep your point of view.'}
      detail={scope === 'visit' ? 'Add a photo from this visit, or look through the rest of this artwork’s photos.' : 'The full painting, a tiny detail, its wall label. Keep the way you saw it.'}>
      <GalleryButton label="Add photos" variant="filled" fullWidth onPress={() => router.push({ pathname: '/add-photos', params: { draftId: `saved:${work.localId}`, savedId: work.localId, title: work.title, visitId: scope === 'visit' ? visitId : undefined } })} />
      {scope === 'visit' && <GalleryButton label="View all photos" onPress={() => { setScope('all'); setPage(0); }} />}
    </EmptyState>}
  </View>;
}
const styles = StyleSheet.create({
  thumbnails: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumbnail: { width: 84, height: 54, padding: 3, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', backgroundColor: Gallery.fill },
  secondary: { color: Gallery.muted, fontSize: 13, lineHeight: 18 },
  title: { fontSize: 18, lineHeight: 22, color: Gallery.ink, fontWeight: '500' },
  medium: { fontSize: 15, lineHeight: 22, color: Gallery.muted },
});
