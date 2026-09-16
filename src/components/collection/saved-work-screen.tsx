import { Host, Switch } from '@expo/ui';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ArtworkEnrichment } from './artwork-enrichment';
import { NoteEditor } from './note-editor';
import { Gallery } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import { selectSavedWork } from '@/db/repos/saved-works';
import type { SavedWork } from '@/db/schema';
import { useCollectionWall } from '@/lib/wall/use-collection-wall';
import { constrainLayout, nextWallLayout, removeWallPiece, type WallLayout } from '@/lib/wall/wall-layout';
import { scheduleRemoval } from '@/lib/collection/pending-removals';
import { LIMITS } from '@/shared/journal/limits';
import { WallArtworkSummary } from './wall-sheets';
import { GalleryButton } from './gallery-button';
import { NativeSegmentedPicker } from './native-segmented-picker';
import { WallFramePicker } from './wall-options';
import { NoteVisibility } from './note-visibility';

export type SavedWorkScreenProps = { savedId: string };
export function SavedWorkScreen({ savedId }: SavedWorkScreenProps) {
  const owner = useLocalOwner();
  const { data } = useLiveQuery(selectSavedWork(savedId, owner), [savedId, owner]);
  const work = data.find((row) => row.owner === owner && row.deletedAt === null);
  return work ? <SavedArtwork key={`${owner}:${savedId}`} work={work} /> : <View style={{ flex: 1, backgroundColor: Gallery.paper }} />;
}
function SavedArtwork({ work }: { work: SavedWork }) {
  const router = useRouter(), wall = useCollectionWall([work]);
  // The hook owns the first read; a later sync can change note eligibility, so it re-reads the loaded wall.
  useEffect(() => { if (wall.signedIn && work.syncedAt && wall.acknowledged) void wall.refresh(); }, [wall.repository, work.syncedAt, wall.signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  const hung = wall.draft?.items.find((item) => item.saveLocalId === work.localId);
  const published = wall.acknowledged?.items.find((item) => item.saveLocalId === work.localId);
  const wallFull = !hung && (wall.draft?.items.length ?? 0) >= LIMITS.wallItems;
  const localPath = work.cropPath ?? work.photoPath;
  const found = wall.pieces.find((item) => item.localId === work.localId);
  // The owner's detail always shows the photo on this device, hung or not, so it stays readable offline.
  const piece = found ? { ...found, cropPath: localPath } : { localId: work.localId, cropPath: localPath,
    layout: nextWallLayout([]), artwork: { title: work.title, artist: work.artist, date: work.date ?? undefined, medium: work.medium ?? undefined,
      media: { kind: 'placeholder' as const, width: 1 as const, height: 1 as const } } };
  async function saveLayout() {
    wall.setError(undefined);
    try { await wall.repository.publishLayout(); }
    catch { wall.setError('Your wall change was not saved. Tap Retry to save these changes.'); }
  }
  function changeLayout(patch: Partial<WallLayout>) {
    if (!wall.draft || !hung || wall.pending) return;
    wall.repository.setLayoutDraft({ ...wall.draft, items: wall.draft.items.map((item) => item.saveLocalId === work.localId ? { ...item, layout: constrainLayout(item.layout, patch) } : item) });
    void saveLayout();
  }
  function toggleWall(value: boolean) {
    if (!wall.draft || wall.pending || (value && wallFull)) return;
    wall.repository.setLayoutDraft(value ? { ...wall.draft, items: [...wall.draft.items, { saveLocalId: work.localId, layout: nextWallLayout(wall.pieces) }] } : removeWallPiece(wall.draft, work.localId));
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
    <WallArtworkSummary piece={piece} color={wall.draft?.color ?? Gallery.accent} />
    <View style={{ paddingHorizontal: 20, gap: 24 }}>
      <View style={{ padding: 14, borderRadius: 10, backgroundColor: Gallery.fill }}>
        <Text style={{ fontSize: 10, color: Gallery.muted }}>SAVED AT</Text>
        {work.visitLocalId ? <GalleryButton label={`${work.venueName ?? 'Museum visit'} · ${new Date(work.savedAt).toLocaleDateString()}`} icon="chevron.right" iconPosition="trailing"
          onPress={() => router.push({ pathname: '/journal/[visitId]', params: { visitId: work.visitLocalId! } })} />
          : <Text style={{ fontSize: 13, lineHeight: 22, color: Gallery.ink }}>{work.venueName ?? work.institution ?? 'Your collection'} · {new Date(work.savedAt).toLocaleDateString()}</Text>}
      </View>
      {work.artworkId && <ArtworkEnrichment artworkId={work.artworkId} />}
      <NoteEditor savedLocalId={work.localId} />
      {!!wall.draft && <>
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
          <NoteVisibility visible={published?.noteVisible ?? false} disabled={wall.pending || !published?.noteEligible}
            onChange={(value) => { void shareNote(value); }} />
          {!published?.noteEligible && <Text style={{ fontSize: 11, color: Gallery.muted }}>Add a note and let it sync before sharing it.</Text>}
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
