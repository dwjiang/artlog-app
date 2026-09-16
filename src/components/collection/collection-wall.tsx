import { randomUUID } from 'expo-crypto';
import { selectArtworkPhotos } from '@/db/repos/artwork-album';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabInset, Gallery } from '@/constants/theme';
import type { SavedWork } from '@/db/schema';
import { useCollectionWall } from '@/lib/wall/use-collection-wall';
import { constrainLayout, isLightWall, nextWallLayout, removeWallPiece, type WallLayout } from '@/lib/wall/wall-layout';
import { socialErrorMessage } from '@/shared/social/errors';
import { LIMITS } from '@/shared/journal/limits';
import { convexErrorCode } from '@/lib/network-error';
import { GalleryButton } from './gallery-button';
import { WallArtworkSheet } from './wall-sheets';
import { WallProfileSheet } from './wall-profile-sheet';
import { WallGallery } from './wall-gallery';
import { WallPhotoPicker } from './wall-photo-picker';
import { WallFramePicker } from './wall-options';
import { SavedWorkImage } from './saved-work-image';
import { WallFrame } from './wall-frame';

export function CollectionWall({ works, hiddenIds, onEditingChange }: { works: SavedWork[]; hiddenIds?: string[]; onEditingChange?: (editing: boolean) => void }) {
  const wall = useCollectionWall(works);
  return <CollectionWallContent works={works} hiddenIds={hiddenIds} onEditingChange={onEditingChange} wall={wall} />;
}

export function CollectionWallContent({ works, hiddenIds = [], onEditingChange, wall }: {
  works: SavedWork[]; hiddenIds?: string[]; onEditingChange?: (editing: boolean) => void; wall: ReturnType<typeof useCollectionWall>;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false), [width, setWidth] = useState(0);
  const [profile, setProfile] = useState(false), [options, setOptions] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const pieces = wall.pieces.filter((piece) => !hiddenIds.includes(piece.saveLocalId ?? piece.localId));
  const selected = pieces.find((piece) => piece.localId === selectedId);
  const color = wall.draft?.color ?? Gallery.accent;
  const count = wall.draft?.items.filter((item) => !hiddenIds.includes(item.saveLocalId)).length ?? 0;
  const wallInk = isLightWall(color) ? Gallery.ink : Gallery.paper;
  const available = wall.selections.filter((item) => !hiddenIds.includes(item.localId));
  // Detail screens edit the wall through their own repository, so each return to this screen re-reads it. The memoized
  // callback reads through a ref so the first load (owned by the hook) and edits in progress are skipped without re-running.
  const focus = useRef({ loaded: false, editing: false });
  useEffect(() => { focus.current = { loaded: !!wall.acknowledged, editing }; }, [wall.acknowledged, editing]);
  useFocusEffect(useCallback(() => {
    if (wall.signedIn && focus.current.loaded && !focus.current.editing) void wall.refresh();
  }, [wall.repository, wall.signedIn])); // eslint-disable-line react-hooks/exhaustive-deps

  function changeEditing(value: boolean) { setEditing(value); onEditingChange?.(value); }
  function edit() {
    if (!wall.draft) return;
    wall.repository.setLayoutDraft(wall.draft);
    wall.setError(undefined); changeEditing(true); void wall.loadSelections(true);
  }
  function cancel() {
    wall.repository.discardDrafts(); wall.setError(undefined); changeEditing(false); setSelectedId(undefined);
  }
  async function publish() {
    if (wall.pending) return;
    wall.setError(undefined);
    try {
      // Layers are reassigned by order because a piece hung while a removal was pending took the layer of a visible one.
      if (wall.draft) wall.repository.setLayoutDraft({ ...wall.draft,
        items: wall.draft.items.filter((item) => !hiddenIds.includes(item.saveLocalId)).map((item, layer) => ({ ...item, layout: { ...item.layout, layer } })),
      });
      await wall.repository.publishLayout(); changeEditing(false); setSelectedId(undefined);
    }
    catch (cause) { wall.setError(convexErrorCode(cause) === 'conflict'
      ? 'Your wall changed on another device. Tap Done again to save these edits, or Cancel to see the latest wall.'
      : socialErrorMessage(cause) ?? 'Your wall was not saved. Check your connection and tap Done to retry.'); }
  }
  function move(id: string, layout: WallLayout) {
    if (!wall.draft || wall.pending) return;
    wall.repository.setLayoutDraft({ ...wall.draft, items: wall.draft.items.map((item) => item.placementId === id
      ? { ...item, layout: constrainLayout(item.layout, layout) } : item) });
  }
  function remove(id: string) {
    if (!wall.draft || wall.pending) return;
    wall.repository.setLayoutDraft(removeWallPiece(wall.draft, id)); setSelectedId(undefined); setOptions(false);
  }
  function add(localId: string) {
    if (!wall.draft || wall.pending || count >= LIMITS.wallItems) return;
    const placementId = randomUUID();
    const photoLocalId = selectArtworkPhotos(localId).all().find((photo) => photo.kind !== 'label')?.localId;
    wall.repository.setLayoutDraft({ ...wall.draft, items: [...wall.draft.items, { placementId, photoLocalId, saveLocalId: localId, layout: nextWallLayout(pieces) }] });
    setSelectedId(placementId);
  }

  return <GestureHandlerRootView style={styles.root}>
    <View style={styles.toolbar}>
      <GalleryButton label={editing ? 'Cancel' : 'All artworks'} icon={editing ? undefined : 'list.bullet'} disabled={wall.pending}
        onPress={editing ? cancel : () => router.push('/all-artworks')} />
      <GalleryButton label={wall.pending ? 'Saving…' : editing ? 'Done' : 'Edit wall'} icon={editing ? undefined : 'slider.horizontal.3'}
        disabled={wall.pending || (!editing && !wall.draft)} onPress={editing ? () => { void publish(); } : edit} />
    </View>
    {editing && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 52 }} contentContainerStyle={styles.swatches}>
      <Text style={styles.caption}>Wall color</Text>
      {Gallery.colors.map(({ name, value: swatchColor }) => <Pressable key={swatchColor} accessibilityRole="button" accessibilityLabel={`${name} wall`}
        accessibilityState={{ selected: color === swatchColor, disabled: wall.pending }} disabled={wall.pending}
        onPress={() => { if (wall.draft) wall.repository.setLayoutDraft({ ...wall.draft, color: swatchColor }); }}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 23, height: 23, borderRadius: 12, backgroundColor: swatchColor, borderWidth: color === swatchColor ? 2 : 0.5, borderColor: Gallery.ink, outlineWidth: color === swatchColor ? 2 : 0, outlineOffset: 3, outlineColor: Gallery.paper }} />
      </Pressable>)}
    </ScrollView>}
    {wall.error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.caption}>{wall.error}</Text>
      {!editing && <GalleryButton label="Try again" onPress={() => { void wall.refresh(); }} />}</View>}
    <ScrollView contentContainerStyle={{ flexGrow: 1 }} scrollEnabled={!wall.pending}
      refreshControl={wall.signedIn && !editing ? <RefreshControl refreshing={wall.loading} tintColor={Gallery.accent} onRefresh={() => { void wall.refresh(); }} /> : undefined}>
      <View accessibilityLabel="Collection wall" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 && <WallGallery pieces={pieces} color={color} width={width} editing={editing && !wall.pending}
          selectedId={selectedId} onRemove={remove} onMove={move} onSelect={(piece) => {
            if (editing) setSelectedId(piece.localId);
            else if (works.some((work) => work.localId === piece.saveLocalId)) router.push({ pathname: '/[savedId]', params: { savedId: piece.saveLocalId! } });
            else { setSelectedId(piece.localId); setOptions(true); }
          }}>
          {!count && <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: wallInk }]}>{wall.loading ? 'Opening your wall…' : 'Your own little museum.'}</Text>
            <Text style={[styles.emptyCaption, { color: wallInk }]}>{!wall.signedIn ? 'A place for the art that stays with you. Sign in to curate your public wall.'
              : wall.profileRequired ? 'Create a profile, then choose the art you’d like to show.' : editing ? 'Tap a saved artwork below to hang it.' : 'Hang a few favorites. Make this space yours.'}</Text>
            {wall.loading ? <ActivityIndicator color={wallInk} /> : !wall.signedIn ? <GalleryButton label="Sign in" inverse={!isLightWall(color)} variant="filled" onPress={() => router.push('/settings')} />
              : wall.profileRequired ? <GalleryButton label="Create your wall" inverse={!isLightWall(color)} variant="filled" onPress={() => setProfile(true)} />
                : !editing && wall.draft ? <GalleryButton label="Curate your wall" variant="filled" inverse={!isLightWall(color)} onPress={edit} /> : !editing ? <GalleryButton label="Load wall" onPress={() => { void wall.refresh(); }} /> : null}
          </View>}
        </WallGallery>}
      </View>
      {!editing && <Text style={styles.footer}>YOUR WALL · {count} {count === 1 ? 'ARTWORK' : 'ARTWORKS'}{count ? '\nA little museum, made by you.' : ''}</Text>}
    </ScrollView>
    {editing && <View style={[styles.tray, { paddingBottom: BottomTabInset + insets.bottom }]}>
      {selected ? <>
        <View style={styles.trayHeading}><GalleryButton label="All saved art" icon="chevron.left" onPress={() => setSelectedId(undefined)} />
          <GalleryButton label="Size & position" onPress={() => setOptions(true)} disabled={wall.pending} /></View>
        {selected.saveLocalId && <WallPhotoPicker savedId={selected.saveLocalId} selectedId={selected.photoLocalId} onSelect={(photoLocalId) => {
          if (wall.draft && !wall.pending) wall.repository.setLayoutDraft({ ...wall.draft, items: wall.draft.items.map((item) => item.placementId === selected.localId ? { ...item, photoLocalId } : item) });
        }} />}
        <GalleryButton label="Hang another photo of this artwork" disabled={wall.pending || count >= LIMITS.wallItems} onPress={() => { if (selected.saveLocalId) add(selected.saveLocalId); }} />
        <View pointerEvents={wall.pending ? 'none' : 'auto'}><WallFramePicker value={selected.layout.frame} onChange={(frame) => move(selected.localId, { ...selected.layout, frame })} /></View>
      </> : <>
        <Text style={[styles.caption, { paddingHorizontal: 18, paddingTop: 12 }]}>YOUR SAVED ART · TAP TO HANG</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 18, padding: 18, alignItems: 'center' }}>
          {available.map((item) => <Pressable key={item.localId} accessibilityRole="button" accessibilityLabel={`Hang ${item.snapshot.title}`}
            disabled={wall.pending || count >= LIMITS.wallItems} onPress={() => add(item.localId)} style={{ width: 66, alignItems: 'center', gap: 7 }}>
            <WallFrame frame="gilt" width={54}><SavedWorkImage path={works.find((work) => work.localId === item.localId)?.cropPath ?? null} title={item.snapshot.title} contain style={{ width: 46, height: 49 }} /></WallFrame>
            <Text numberOfLines={1} style={{ fontSize: 10, color: Gallery.muted }}>{item.snapshot.artist}</Text>
          </Pressable>)}
          {wall.loadingSelections ? <ActivityIndicator color={Gallery.accent} /> : wall.cursor !== null ? <GalleryButton label="More artworks" onPress={() => { void wall.loadSelections(); }} />
            : !available.length ? <Text style={styles.caption}>Save an artwork to add it to your wall.</Text> : null}
        </ScrollView>
      </>}
    </View>}
    {options && selected && <WallArtworkSheet piece={selected} editing={editing && !wall.pending} color={color} onDismiss={() => setOptions(false)} onChange={(layout) => move(selected.localId, layout)} onRemove={() => remove(selected.localId)} />}
    {profile && <WallProfileSheet onDismiss={() => setProfile(false)} onCreated={() => { setProfile(false); void wall.refresh(); }} />}
  </GestureHandlerRootView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, minHeight: 52, borderTopWidth: 0.5, borderTopColor: Gallery.separator },
  caption: { fontSize: 11, lineHeight: 17, color: Gallery.muted },
  swatches: { alignItems: 'center', paddingHorizontal: 18, gap: 1, paddingBottom: 8 },
  error: { paddingHorizontal: 18, paddingVertical: 10, backgroundColor: Gallery.fill },
  empty: { minHeight: 440, padding: 32, alignItems: 'center', justifyContent: 'center', gap: 20 },
  emptyTitle: { fontSize: 24, fontWeight: '600', textAlign: 'center' },
  emptyCaption: { fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 280, opacity: 0.85 },
  footer: { fontSize: 10, lineHeight: 22, letterSpacing: 0.6, color: Gallery.muted, textAlign: 'center', padding: 24 },
  tray: { backgroundColor: Gallery.paper, borderTopWidth: 0.5, borderTopColor: Gallery.separator },
  trayHeading: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12 },
});
