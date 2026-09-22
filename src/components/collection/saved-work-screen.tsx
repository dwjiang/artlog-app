import { reportError } from '@/lib/observability';
import { LoadingRing } from '@/components/loading-ring';
import { ThemedText as Text } from '@/components/themed-text';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { Host, Switch } from '@expo/ui';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ArtworkEnrichment } from './artwork-enrichment';
import { NoteEditor } from './note-editor';
import { Gallery } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import { selectSavedWork } from '@/db/repos/saved-works';
import { selectArtworkPhotos } from '@/db/repos/artwork-album';
import type { SavedWork } from '@/db/schema';
import { useCollectionWall } from '@/lib/wall/use-collection-wall';
import { nextWallLayout } from '@/lib/wall/wall-layout';
import { LIMITS } from '@/shared/journal/limits';
import { ArtworkAlbum } from './artwork-album';
import { GalleryButton } from './gallery-button';
import { ArtworkEncounterList, ArtworkVisitNote, useArtworkEncounters } from './artwork-encounters';
import { ArtworkQueryState } from './artwork-query-state';

export type SavedWorkScreenProps = { savedId: string; visitId?: string; photoId?: string; editNote?: boolean };
export function SavedWorkScreen({ savedId, visitId, photoId, editNote }: SavedWorkScreenProps) {
  const owner = useLocalOwner();
  const [attempt, setAttempt] = useState(0);
  return <SavedWorkQuery key={`${owner}:${savedId}:${attempt}`} owner={owner} savedId={savedId} visitId={visitId} photoId={photoId} editNote={editNote} onRetry={() => setAttempt((value) => value + 1)} />;
}
function SavedWorkQuery({ owner, savedId, visitId, photoId, editNote, onRetry }: SavedWorkScreenProps & { owner: string; onRetry: () => void }) {
  const { data, error, updatedAt } = useLiveQuery(selectSavedWork(savedId, owner), [savedId, owner]);
  useEffect(() => { if (error) reportError(error, 'collection.artwork.load'); }, [error]);
  const work = data.find((row) => row.owner === owner && row.localId === savedId && row.deletedAt === null);
  return work ? <SavedArtwork key={`${owner}:${savedId}:${visitId ?? ''}:${photoId ?? ''}`} work={work} visitId={visitId} photoId={photoId} editNote={editNote} />
    : <ArtworkQueryState item="Artwork" loading={!updatedAt} error={error} onRetry={onRetry} />;
}
function Divider() { return <View style={styles.divider} />; }
function SavedArtwork({ work, visitId, photoId, editNote }: { work: SavedWork; visitId?: string; photoId?: string; editNote?: boolean }) {
  const router = useRouter(), wall = useCollectionWall([work]);
  const { encounters, loading: loadingEncounters, error: encounterError } = useArtworkEncounters(work);
  const currentEncounter = encounters.find(({ visit }) => visit.localId === visitId);
  const { data: photos } = useLiveQuery(selectArtworkPhotos(work.localId, work.owner), [work.localId, work.owner]);
  const wallPhoto = photos.find((photo) => photo.kind !== 'label') ?? photos[0];
  const hung = wall.draft?.items.find((item) => item.saveLocalId === work.localId);
  const wallFull = !hung && (wall.draft?.items.length ?? 0) >= LIMITS.wallItems;
  async function saveLayout() {
    wall.setError(undefined);
    try { await wall.repository.publishLayout(); }
    catch (cause) { reportError(cause, 'wall.layout.publish'); wall.setError('Your wall change was not saved. Tap Retry to save these changes.'); }
  }
  function toggleWall(value: boolean) {
    if (!wall.draft || wall.pending || (value && wallFull)) return;
    wall.repository.setLayoutDraft(value ? { ...wall.draft, items: [...wall.draft.items, { placementId: randomUUID(), saveLocalId: work.localId, photoLocalId: wallPhoto?.localId, layout: nextWallLayout(wall.pieces) }] } : { ...wall.draft, items: wall.draft.items.filter((item) => item.saveLocalId !== work.localId).map((item, layer) => ({ ...item, layout: { ...item.layout, layer } })) });
    void saveLayout();
  }
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets
    keyboardDismissMode="interactive" contentContainerStyle={{ paddingBottom: 35 }}>
    <View style={{ paddingHorizontal: 20, gap: 8 }}>
      <ArtworkAlbum key={currentEncounter?.visit.localId ?? 'all'} work={work} visitId={currentEncounter?.visit.localId} photoId={photoId} />
      {wall.signedIn && !work.syncedAt && <View style={{ padding: 14, gap: 12, backgroundColor: '#EEF2FF' }}><Text style={{ fontSize: 14, lineHeight: 21 }}>Saved on this iPhone. Waiting to sync before this artwork can appear on your public wall.</Text><Text variant="metadata">On your wall · Waiting for sync</Text><GalleryButton label="Back" onPress={() => router.back()} /></View>}
      <GalleryButton label="Adjust crop" icon="crop" onPress={() => router.push({ pathname: '/adjust-crop', params: { savedId: work.localId } })} />
      <Divider />
      <ArtworkEncounterList work={work} encounters={encounters} loading={loadingEncounters} loadError={encounterError} visitId={currentEncounter?.visit.localId} />
      <Divider />
      <NoteEditor savedLocalId={work.localId} initiallyEditing={editNote} sharedOnWall={wall.acknowledged?.items.some((item) => item.saveLocalId === work.localId && item.noteVisible)} />
      {currentEncounter && <ArtworkVisitNote work={work} encounter={currentEncounter} />}
      {work.artworkId && <ArtworkEnrichment artworkId={work.artworkId} />}
      {!!wall.draft && <>
        <Divider />
        <Host matchContents={{ vertical: true }} colorScheme="light" seedColor={Gallery.accent}>
          <Switch label="On your wall" value={!!hung} onValueChange={toggleWall} disabled={wall.pending || !work.syncedAt || wallFull} />
        </Host>
        {wallFull && <Text style={styles.caption}>Your wall holds {LIMITS.wallItems} artworks. Take one off to hang this piece.</Text>}
        {hung && <>
          <Divider />
          <Pressable accessibilityRole="button" accessibilityLabel="Wall display options" onPress={() => router.push({ pathname: '/wall-display', params: { savedId: work.localId } })} style={styles.row}>
            <Image source="sf:slider.horizontal.3" tintColor={Gallery.ink} style={{ width: 22, height: 22 }} accessible={false} />
            <Text style={styles.rowLabel}>Wall display options</Text>
            <Image source="sf:chevron.right" tintColor={Gallery.muted} style={{ width: 13, height: 13 }} accessible={false} />
          </Pressable>
        </>}
      </>}
      {wall.error && <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{wall.error}</Text>
        <GalleryButton label="Retry" disabled={wall.pending} onPress={() => { if (wall.layoutDraft) void saveLayout(); else void wall.refresh(); }} /></View>}
      {wall.pending && <LoadingRing accessibilityLabel="Saving wall changes…" />}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Gallery.separator },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 6 },
  rowLabel: { flex: 1, fontSize: 17, lineHeight: 23, color: Gallery.ink },
});
