import { ThemedText as Text } from '@/components/themed-text';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { editEncounter, selectArtworkEncounters, selectArtworkPhotos } from '@/db/repos/artwork-album';
import { listVisits } from '@/db/repos/visits';
import type { SavedWork } from '@/db/schema';
import { formatVisitDate } from '@/lib/journal/history';
import { showToast } from '@/lib/ui/toast';
import { GalleryButton } from './gallery-button';

export function useArtworkEncounters(work: SavedWork) {
  const encounters = useLiveQuery(selectArtworkEncounters(work.owner), [work.owner]);
  const visits = useLiveQuery(listVisits(work.owner), [work.owner]);
  const photos = useLiveQuery(selectArtworkPhotos(work.localId, work.owner), [work.localId, work.owner]);
  return visits.data.filter((visit) => visit.owner === work.owner).flatMap((visit) => {
    const encounter = encounters.data.find((row) => row.owner === work.owner && row.savedLocalId === work.localId && row.visitLocalId === visit.localId && row.deletedAt === null);
    return encounter ? [{ visit, note: encounter.note, photoCount: photos.data.filter((photo) => photo.owner === work.owner && photo.savedLocalId === work.localId && photo.visitLocalId === visit.localId).length }] : [];
  });
}

type Encounter = ReturnType<typeof useArtworkEncounters>[number];

export function ArtworkVisitNote({ work, encounter }: { work: SavedWork; encounter: Encounter }) {
  const [editing, setEditing] = useState(false), [note, setNote] = useState(''), [error, setError] = useState<string>();
  return <View style={styles.context}>
    <Text variant="section" accessibilityRole="header" style={styles.heading}>This visit · private note</Text>
    {editing ? <>
      <TextInput accessibilityLabel="Private encounter note" value={note} onChangeText={setNote} multiline maxLength={2000}
        placeholder="What did you notice this time?" placeholderTextColor={Gallery.muted} style={styles.input} />
      <View style={styles.actions}>
        <GalleryButton label="Save encounter note" onPress={() => {
          try { editEncounter(work.localId, encounter.visit.localId, { note }, work.owner); setEditing(false); setError(undefined); showToast('Private note saved for this encounter.'); }
          catch { setError('Your note could not be saved. Try again.'); }
        }} />
        <GalleryButton label="Cancel" onPress={() => { setEditing(false); setError(undefined); }} />
      </View>
    </> : <>
      {!!encounter.note && <Text selectable style={styles.note}>{encounter.note}</Text>}
      <GalleryButton label={encounter.note ? 'Edit encounter note' : 'Add an encounter note'} onPress={() => { setNote(encounter.note ?? ''); setEditing(true); }} />
    </>}
    {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
  </View>;
}

export function ArtworkEncounterList({ work, encounters, visitId }: { work: SavedWork; encounters: Encounter[]; visitId?: string }) {
  const [error, setError] = useState<string>();
  const current = encounters.find(({ visit }) => visit.localId === visitId);
  return <View>
    <View style={styles.actions}>
      <Text variant="section" accessibilityRole="header" style={styles.heading}>Seen on {encounters.length} {encounters.length === 1 ? 'visit' : 'visits'}</Text>
      <GalleryButton label="Link visit" icon="plus" onPress={() => router.push({ pathname: '/link-artwork', params: { savedId: work.localId } })} />
    </View>
    {encounters.map(({ visit, photoCount }) => <Pressable key={visit.localId} accessibilityRole="button"
      accessibilityLabel={`View ${work.title} at ${visit.venueName}, ${formatVisitDate(visit.visitedOn)}`}
      accessibilityState={{ selected: visit.localId === visitId }} disabled={visit.localId === visitId}
      onPress={() => router.push({ pathname: '/saved/[savedId]', params: { savedId: work.localId, visitId: visit.localId } })} style={styles.visit}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.visitName}>{visit.venueName}</Text>
        <Text style={styles.caption}>{formatVisitDate(visit.visitedOn)} · {photoCount} {photoCount === 1 ? 'photo' : 'photos'}</Text>
        {visit.localId === visitId && <Text style={[styles.caption, { color: Gallery.accent }]}>Viewing this visit</Text>}
      </View>
      <Text style={styles.caption}>›</Text>
    </Pressable>)}
    {!encounters.length && <Text style={styles.caption}>Saved without a visit. You can link one anytime.</Text>}
    {current && <GalleryButton label="Unlink from this visit" onPress={() => Alert.alert('Unlink this visit?', 'Your artwork, photos, and visit stay in your journal.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Unlink', onPress: () => {
        try { editEncounter(work.localId, current.visit.localId, { deletedAt: Date.now() }, work.owner); router.replace({ pathname: '/saved/[savedId]', params: { savedId: work.localId } }); }
        catch { setError('This visit could not be unlinked. Try again.'); }
      } },
    ])} />}
    {error && <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  context: { borderTopWidth: 1, borderTopColor: Gallery.separator, paddingTop: 16, gap: 8 },
  heading: { color: Gallery.ink },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  note: { fontSize: 17, lineHeight: 25, color: Gallery.ink },
  input: { minHeight: 96, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: Gallery.controlBorder, color: Gallery.ink, backgroundColor: Gallery.surface, fontSize: 15, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  visit: { paddingVertical: 14, borderBottomWidth: 0.5, borderColor: Gallery.separator, flexDirection: 'row', alignItems: 'center', gap: 10 },
  visitName: { fontSize: 13, fontWeight: '500', color: Gallery.ink },
});
