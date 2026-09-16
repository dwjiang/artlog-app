import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gallery } from '@/constants/theme';
import { editEncounter, selectArtworkEncounters, selectArtworkPhotos } from '@/db/repos/artwork-album';
import { listVisits } from '@/db/repos/visits';
import type { SavedWork } from '@/db/schema';
import { captureFileUri } from '@/lib/files/photos';
import { formatVisitDate } from '@/lib/journal/history';
import { NativeSegmentedPicker } from './native-segmented-picker';
import { GalleryButton } from './gallery-button';

export function ArtworkAlbum({ work, visitId }: { work: SavedWork; visitId?: string }) {
  const photos = useLiveQuery(selectArtworkPhotos(work.localId, work.owner), [work.localId, work.owner]);
  const encounters = useLiveQuery(selectArtworkEncounters(work.owner), [work.owner]);
  const visits = useLiveQuery(listVisits(work.owner), [work.owner]);
  const [scope, setScope] = useState<'all' | 'visit'>(visitId ? 'visit' : 'all');
  const [editingVisit, setEditingVisit] = useState<string>();
  const [note, setNote] = useState('');
  const [page, setPage] = useState(0);
  const width = useWindowDimensions().width - 40;
  const rows = photos.data.filter((row) => row.owner === work.owner && row.savedLocalId === work.localId && (scope === 'all' || row.visitLocalId === visitId));
  const linked = new Set(encounters.data.filter((row) => row.owner === work.owner && row.savedLocalId === work.localId).map((row) => row.visitLocalId));
  return <View style={{ gap: 18 }}>
    {!!visitId && <NativeSegmentedPicker label="Photo scope" value={scope} onChange={(value) => { setScope(value); setPage(0); }} options={[{ value: 'visit', label: 'This visit' }, { value: 'all', label: 'All photos' }]} />}
    {!rows.length && <Text style={styles.secondary}>No photos from this visit yet. View all photos or add one.</Text>}
    <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={({ nativeEvent }) => setPage(Math.round(nativeEvent.contentOffset.x / width))}>
      {rows.map((photo, i) => <View key={photo.localId} style={{ width, gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${photo.kind} photo ${i + 1}`} onPress={() => router.push({ pathname: '/photo-details', params: { savedId: work.localId, photoId: photo.localId } })} style={styles.frame}>
          {photo.path ? <Image source={{ uri: captureFileUri(photo.path) }} accessibilityLabel={`${photo.kind} photo ${i + 1} of ${work.title}`}
            style={{ width: '100%', height: 285 }} contentFit="contain" /> : <Text style={styles.secondary}>Downloading photo…</Text>}
        </Pressable>
        <Text style={styles.secondary}>{photo.kind === 'full' ? 'Full view' : photo.kind === 'detail' ? 'Detail' : 'Label'}{photo.caption ? ` · ${photo.caption}` : ''}</Text>
      </View>)}
    </ScrollView>
    <View style={styles.row}><Text style={styles.secondary}>{rows.length ? `${Math.min(page + 1, rows.length)} / ${rows.length} photos` : 'Your photos'} · Only you</Text>
      <GalleryButton label="Add photos" icon="photo.badge.plus" onPress={() => router.push({ pathname: '/add-photos', params: { draftId: `saved:${work.localId}`, savedId: work.localId, title: work.title, visitId } })} /></View>
    <View style={{ gap: 5 }}>
      <Text style={styles.title}>{work.title}</Text><Text style={{ color: Gallery.ink, fontSize: 14 }}>{work.artist || 'Artist unknown'}</Text>
      <Text style={styles.secondary}>{[work.date, work.medium].filter(Boolean).join(' · ')}</Text>
    </View>
    <View style={{ gap: 8 }}>
      <View style={styles.row}><Text style={styles.label}>SEEN ON {linked.size} {linked.size === 1 ? 'VISIT' : 'VISITS'}</Text>
        <GalleryButton label="Link visit" icon="plus" onPress={() => router.push({ pathname: '/link-artwork', params: { savedId: work.localId } })} /></View>
      {visits.data.filter((visit) => visit.owner === work.owner && linked.has(visit.localId)).map((visit) => {
        const encounter = encounters.data.find((row) => row.savedLocalId === work.localId && row.visitLocalId === visit.localId);
        return <View key={visit.localId} style={styles.visit}>
          <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/journal/[visitId]', params: { visitId: visit.localId } })}>
            <Text style={{ color: Gallery.ink, fontSize: 13 }}>{visit.venueName}</Text><Text style={styles.secondary}>{formatVisitDate(visit.visitedOn)}</Text>
          </Pressable>
          {!!encounter?.note && editingVisit !== visit.localId && <Text style={{ color: Gallery.ink, fontSize: 13 }}>{encounter.note}</Text>}
          {editingVisit === visit.localId ? <>
            <TextInput accessibilityLabel="Private encounter note" value={note} onChangeText={setNote} multiline maxLength={2000} placeholder="What did you notice this time?" style={{ minHeight: 70, color: Gallery.ink }} />
            <GalleryButton label="Save encounter note" onPress={() => { editEncounter(work.localId, visit.localId, { note }, work.owner); setEditingVisit(undefined); }} />
          </> : <View style={styles.row}>
            <GalleryButton label={encounter?.note ? 'Edit encounter note' : 'Add encounter note'} onPress={() => { setNote(encounter?.note ?? ''); setEditingVisit(visit.localId); }} />
            <GalleryButton label="Unlink" onPress={() => Alert.alert('Unlink this visit?', 'Your artwork, photos, and visit stay in your journal.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Unlink', onPress: () => editEncounter(work.localId, visit.localId, { deletedAt: Date.now() }, work.owner) }])} />
          </View>}
        </View>;
      })}
      {!linked.size && <Text style={styles.secondary}>Saved without a visit. You can link one anytime.</Text>}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  frame: { backgroundColor: '#E5E5DE', padding: 15, minHeight: 285, borderRadius: 4, justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  secondary: { color: Gallery.muted, fontSize: 11, lineHeight: 17 },
  title: { fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 25, lineHeight: 31, color: Gallery.ink },
  label: { fontSize: 10, letterSpacing: 1.2, color: Gallery.muted },
  visit: { padding: 14, backgroundColor: Gallery.fill, borderRadius: 10, gap: 5 },
});
