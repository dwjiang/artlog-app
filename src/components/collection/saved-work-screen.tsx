import { randomUUID } from 'expo-crypto';
import { Host, Switch } from '@expo/ui';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ArtworkEnrichment } from './artwork-enrichment';
import { NoteEditor } from './note-editor';
import { Gallery } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import { selectSavedWork } from '@/db/repos/saved-works';
import { selectArtworkPhotos } from '@/db/repos/artwork-album';
import type { SavedWork } from '@/db/schema';
import { useCollectionWall } from '@/lib/wall/use-collection-wall';
import { constrainLayout, nextWallLayout, type WallLayout } from '@/lib/wall/wall-layout';
import { scheduleRemoval } from '@/lib/collection/pending-removals';
import { LIMITS } from '@/shared/journal/limits';
import { ArtworkAlbum } from './artwork-album';
import { GalleryButton } from './gallery-button';
import { NativeSegmentedPicker } from './native-segmented-picker';
import { WallFramePicker } from './wall-options';
import { NoteVisibility } from './note-visibility';
import { ArtworkEncounterList, ArtworkVisitNote, useArtworkEncounters } from './artwork-encounters';
import { formatVisitDate } from '@/lib/journal/history';

export type SavedWorkScreenProps = { savedId: string; visitId?: string; photoId?: string };
export function SavedWorkScreen({ savedId, visitId, photoId }: SavedWorkScreenProps) {
  const owner = useLocalOwner();
  const { data } = useLiveQuery(selectSavedWork(savedId, owner), [savedId, owner]);
  const work = data.find((row) => row.owner === owner && row.deletedAt === null);
  return work ? <SavedArtwork key={`${owner}:${savedId}:${visitId ?? ''}:${photoId ?? ''}`} work={work} visitId={visitId} photoId={photoId} /> : <View style={{ flex: 1, backgroundColor: Gallery.paper }} />;
}
function SavedArtwork({ work, visitId, photoId }: { work: SavedWork; visitId?: string; photoId?: string }) {
  const router = useRouter(), wall = useCollectionWall([work]);
  const [displayOptions, setDisplayOptions] = useState(false);
  const encounters = useArtworkEncounters(work);
  const currentEncounter = encounters.find(({ visit }) => visit.localId === visitId);
  const { data: photos } = useLiveQuery(selectArtworkPhotos(work.localId, work.owner), [work.localId, work.owner]);
  const wallPhoto = photos.find((photo) => photo.kind !== 'label') ?? photos[0];
  // The hook owns the first read; a later sync can change note eligibility, so it re-reads the loaded wall.
  useEffect(() => { if (wall.signedIn && work.syncedAt && wall.acknowledged) void wall.refresh(); }, [wall.repository, work.syncedAt, wall.signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  const hung = wall.draft?.items.find((item) => item.saveLocalId === work.localId);
  const published = wall.acknowledged?.items.find((item) => item.saveLocalId === work.localId);
  const wallFull = !hung && (wall.draft?.items.length ?? 0) >= LIMITS.wallItems;
  async function saveLayout() {
    wall.setError(undefined);
    try { await wall.repository.publishLayout(); }
    catch { wall.setError('Your wall change was not saved. Tap Retry to save these changes.'); }
  }
  function changeLayout(patch: Partial<WallLayout>) {
    if (!wall.draft || !hung || wall.pending) return;
    wall.repository.setLayoutDraft({ ...wall.draft, items: wall.draft.items.map((item) => item.placementId === hung.placementId ? { ...item, layout: constrainLayout(item.layout, patch) } : item) });
    void saveLayout();
  }
  function toggleWall(value: boolean) {
    if (!wall.draft || wall.pending || (value && wallFull)) return;
    wall.repository.setLayoutDraft(value ? { ...wall.draft, items: [...wall.draft.items, { placementId: randomUUID(), saveLocalId: work.localId, photoLocalId: wallPhoto?.localId, layout: nextWallLayout(wall.pieces) }] } : { ...wall.draft, items: wall.draft.items.filter((item) => item.saveLocalId !== work.localId).map((item, layer) => ({ ...item, layout: { ...item.layout, layer } })) });
    void saveLayout();
  }
  async function shareNote(value: boolean) {
    if (!published || wall.pending) return;
    wall.setError(undefined);
    try { wall.repository.setNoteDraft([{ itemId: published.itemId, visible: value }]); await wall.repository.publishNotes(); }
    catch { wall.setError('This note could not be shared. Refresh to review the latest synced note and try again.'); }
  }
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets
    keyboardDismissMode="interactive" contentContainerStyle={{ paddingBottom: 35 }}>

    <View style={{ paddingHorizontal: 20, gap: 24 }}>
      <ArtworkAlbum key={currentEncounter?.visit.localId ?? 'all'} work={work} visitId={currentEncounter?.visit.localId} photoId={photoId} color={wall.draft?.color} />
      {currentEncounter ? <GalleryButton label={`From ${currentEncounter.visit.venueName} · ${formatVisitDate(currentEncounter.visit.visitedOn)}`} icon="building.columns"
        onPress={() => router.push({ pathname: '/journal/[visitId]', params: { visitId: currentEncounter.visit.localId } })} />
        : <Text style={{ fontSize: 11, lineHeight: 17, color: Gallery.muted }}>{photos.length} {photos.length === 1 ? 'photo' : 'photos'} · {encounters.length} {encounters.length === 1 ? 'visit' : 'visits'} · one artwork in your collection.</Text>}
      {work.artworkId && <ArtworkEnrichment artworkId={work.artworkId} />}
      {currentEncounter && <ArtworkVisitNote work={work} encounter={currentEncounter} />}
      <NoteEditor savedLocalId={work.localId} />
      {hung && <>
        <NoteVisibility visible={published?.noteVisible ?? false} disabled={wall.pending || !published?.noteEligible} onChange={(value) => { void shareNote(value); }} />
        {!published?.noteEligible && <Text style={{ fontSize: 11, color: Gallery.muted }}>Add a note and let it sync before sharing it.</Text>}
      </>}
      <ArtworkEncounterList work={work} encounters={encounters} visitId={currentEncounter?.visit.localId} />
      <GalleryButton label={work.title === 'Unidentified artwork' ? 'Identify this artwork' : 'Edit artwork details'} icon="pencil" onPress={() => router.push({ pathname: '/identify-artwork', params: { savedId: work.localId } })} />
      {!!wall.draft && <>
        <GalleryButton label={displayOptions ? 'Hide wall display options' : 'Wall display options'} icon="slider.horizontal.3" onPress={() => setDisplayOptions(!displayOptions)} />
        {displayOptions && <>
        <Host matchContents={{ vertical: true }} colorScheme="light" seedColor={Gallery.accent}>
          <Switch label="On your wall" value={!!hung} onValueChange={toggleWall} disabled={wall.pending || !work.syncedAt || wallFull} />
        </Host>
        {wallFull && <Text style={{ fontSize: 11, color: Gallery.muted }}>Your wall holds {LIMITS.wallItems} artworks. Take one off to hang this piece.</Text>}
        {hung && <>
          <View style={{ gap: 10 }}><Text style={{ fontSize: 12, fontWeight: '600', color: Gallery.ink }}>FRAME</Text>
            <View pointerEvents={wall.pending ? 'none' : 'auto'}><WallFramePicker value={hung.layout.frame} onChange={(frame) => changeLayout({ frame })} /></View></View>
          <NativeSegmentedPicker label="Size on wall" value={hung.layout.width < 0.3 ? 'small' : hung.layout.width > 0.45 ? 'large' : 'medium'} disabled={wall.pending}
            options={[{ value: 'small', label: 'S' }, { value: 'medium', label: 'M' }, { value: 'large', label: 'L' }]}
            onChange={(size) => changeLayout({ width: size === 'small' ? 0.24 : size === 'medium' ? 0.36 : 0.52 })} />
        </>}
        </>}
      </>}
      {wall.error && <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{wall.error}</Text>
        <GalleryButton label="Retry" disabled={wall.pending} onPress={() => { if (wall.layoutDraft) void saveLayout(); else void wall.refresh(); }} /></View>}
      <GalleryButton label="Remove from collection" icon="trash" destructive onPress={() => {
        scheduleRemoval({ owner: work.owner, localId: work.localId, title: work.title }); router.back();
      }} />
    </View>
  </ScrollView>;
}
