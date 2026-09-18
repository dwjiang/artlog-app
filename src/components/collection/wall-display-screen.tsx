import { ThemedText as Text } from '@/components/themed-text';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Gallery } from '@/constants/theme';
import { useLocalOwner } from '@/lib/account/owner-store';
import { selectSavedWork } from '@/db/repos/saved-works';
import type { SavedWork } from '@/db/schema';
import { useCollectionWall } from '@/lib/wall/use-collection-wall';
import { constrainLayout, type WallFrame } from '@/lib/wall/wall-layout';
import { NativeSegmentedPicker } from './native-segmented-picker';
import { ArtworkQueryState } from './artwork-query-state';
import { GalleryButton } from './gallery-button';
import { NoteVisibility } from './note-visibility';
import { PhotoVisibility } from './photo-visibility';
import { WallFramePicker } from './wall-options';
import { WallPhotoPicker } from './wall-photo-picker';

export function WallDisplayScreen({ savedId }: { savedId: string }) {
  const owner = useLocalOwner();
  const [attempt, setAttempt] = useState(0);
  return <WallDisplayQuery key={`${owner}:${savedId}:${attempt}`} owner={owner} savedId={savedId} onRetry={() => setAttempt((value) => value + 1)} />;
}

function WallDisplayQuery({ owner, savedId, onRetry }: { owner: string; savedId: string; onRetry: () => void }) {
  const { data, error, updatedAt } = useLiveQuery(selectSavedWork(savedId, owner), [savedId, owner]);
  const work = data.find((row) => row.owner === owner && row.localId === savedId && row.deletedAt === null);
  return work ? <WallDisplay work={work} /> : <ArtworkQueryState item="Artwork" loading={!updatedAt} error={error} onRetry={onRetry} />;
}

/** Everything about how one hung artwork appears on the public wall: frame, the photo shown, and the note. */
function WallDisplay({ work }: { work: SavedWork }) {
  const wall = useCollectionWall([work]);
  const hung = wall.draft?.items.find((item) => item.saveLocalId === work.localId);
  const published = wall.acknowledged?.items.find((item) => item.saveLocalId === work.localId);
  // The hook owns the first read; a later sync can change note eligibility, so it re-reads the loaded wall.
  useEffect(() => { if (wall.signedIn && work.syncedAt && wall.acknowledged) void wall.refresh(); }, [wall.repository, work.syncedAt, wall.signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  async function saveLayout() {
    wall.setError(undefined);
    try { await wall.repository.publishLayout(); }
    catch { wall.setError('Your wall change was not saved. Tap Retry to save these changes.'); }
  }
  function change(patch: { frame?: WallFrame; width?: number; photoLocalId?: string }) {
    if (!wall.draft || !hung || wall.pending) return;
    const { photoLocalId, ...layout } = patch;
    wall.repository.setLayoutDraft({ ...wall.draft, items: wall.draft.items.map((item) => item.placementId === hung.placementId
      ? { ...item, ...(photoLocalId ? { photoLocalId } : {}), layout: constrainLayout(item.layout, layout) } : item) });
    void saveLayout();
  }
  async function shareNote(value: boolean) {
    if (!published || wall.pending) return;
    wall.setError(undefined);
    try { wall.repository.setNoteDraft([{ itemId: published.itemId, visible: value }]); await wall.repository.publishNotes(); }
    catch { wall.setError('This note could not be shared. Refresh to review the latest synced note and try again.'); }
  }
  return <ScrollView style={{ flex: 1, backgroundColor: Gallery.paper }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
    <Text variant="display" accessibilityRole="header" style={{ color: Gallery.ink }}>{work.title}</Text>
    {!wall.draft ? <Text style={styles.caption}>{wall.loading ? 'Opening your wall…' : 'Your wall is unavailable right now.'}</Text>
      : !hung ? <Text style={styles.caption}>This artwork is not on your wall.</Text> : <>
      <View style={styles.section}><Text style={styles.label}>FRAME</Text>
        <View pointerEvents={wall.pending ? 'none' : 'auto'}><WallFramePicker value={hung.layout.frame} onChange={(frame) => change({ frame })} /></View></View>
      <View style={styles.section}><Text style={styles.label}>SIZE ON WALL</Text>
        <NativeSegmentedPicker label="Size on wall" value={hung.layout.width < 0.3 ? 'small' : hung.layout.width > 0.45 ? 'large' : 'medium'} disabled={wall.pending}
          options={[{ value: 'small', label: 'S' }, { value: 'medium', label: 'M' }, { value: 'large', label: 'L' }]}
          onChange={(size) => change({ width: size === 'small' ? 0.24 : size === 'medium' ? 0.36 : 0.52 })} />
        <Text style={styles.caption}>Drag artworks on your wall to move them, or use Edit wall for exact placement.</Text></View>
      <View style={styles.section}><Text style={styles.label}>WALL PHOTO</Text>
        <Text style={styles.caption}>Only the selected photo is public. Other photos stay private.</Text>
        <View pointerEvents={wall.pending ? 'none' : 'auto'}><WallPhotoPicker savedId={work.localId} selectedId={hung.photoLocalId} onSelect={(photoLocalId) => change({ photoLocalId })} /></View>
        {hung.photoLocalId && <PhotoVisibility savedId={work.localId} photoId={hung.photoLocalId} />}</View>
      <View style={styles.section}>
        <NoteVisibility visible={published?.noteVisible ?? false} disabled={wall.pending || !published?.noteEligible} onChange={(value) => { void shareNote(value); }} />
        {!published?.noteEligible && <Text style={styles.caption}>Add a note and let it sync before sharing it.</Text>}
      </View>
    </>}
    {wall.error && <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>{wall.error}</Text>
      <GalleryButton label="Retry" disabled={wall.pending} onPress={() => { if (wall.layoutDraft) void saveLayout(); else void wall.refresh(); }} /></View>}
    {wall.pending && <Text accessibilityLiveRegion="polite" style={styles.caption}>Saving wall changes…</Text>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingVertical: 16, gap: 24 },
  section: { gap: 10 },
  label: { fontSize: 13, letterSpacing: 0.8, fontWeight: '600', color: Gallery.ink },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
});
