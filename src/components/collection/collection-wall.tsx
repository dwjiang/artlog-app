import { randomUUID } from 'expo-crypto';
import { selectArtworkPhotos } from '@/db/repos/artwork-album';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabInset, Gallery } from '@/constants/theme';
import type { SavedWork } from '@/db/schema';
import { useCollectionWall } from '@/lib/wall/use-collection-wall';
import { constrainLayout, isLightWall, nextWallLayout, removeWallPiece, type WallDraft, type WallLayout } from '@/lib/wall/wall-layout';
import { captureOwner } from '@/lib/account/owner-store';
import { LIMITS } from '@/shared/journal/limits';
import { convexErrorCode } from '@/lib/network-error';
import { showToast } from '@/lib/ui/toast';
import { GalleryButton } from './gallery-button';
import { signInRoute } from '@/lib/account/sign-in-context';
import { WallArtworkSheet } from './wall-sheets';
import { WallProfileSheet } from './wall-profile-sheet';
import { WallGallery } from './wall-gallery';
import { WallFramePicker } from './wall-options';
import { SavedWorkImage } from './saved-work-image';
import { WallFrame } from './wall-frame';
import { WallPhotoSheet } from './wall-photo-sheet';

type CollectionWallProps = { works: SavedWork[]; hiddenIds?: string[]; onEditingChange?: (editing: boolean) => void; header?: ReactElement; controls?: ReactElement };
export function CollectionWall({ works, hiddenIds, onEditingChange, header, controls }: CollectionWallProps) {
  const wall = useCollectionWall(works);
  return <CollectionWallContent works={works} hiddenIds={hiddenIds} onEditingChange={onEditingChange} wall={wall} header={header} controls={controls} />;
}

export function CollectionWallContent({ works, hiddenIds = [], onEditingChange, wall, header, controls }: CollectionWallProps & { wall: ReturnType<typeof useCollectionWall> }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false), [width, setWidth] = useState(0);
  const [profile, setProfile] = useState(false), [options, setOptions] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [photoPicker, setPhotoPicker] = useState<'choose' | 'duplicate'>();
  const scroll = useRef<ScrollView>(null), wallTop = useRef(0), controlsHeight = useRef(0);
  const revealId = useRef<string | undefined>(undefined);
  const pieces = wall.pieces.filter((piece) => !hiddenIds.includes(piece.saveLocalId ?? piece.localId));
  const selected = pieces.find((piece) => piece.localId === selectedId);
  const color = wall.draft?.color ?? Gallery.accent;
  const count = wall.draft?.items.filter((item) => !hiddenIds.includes(item.saveLocalId)).length ?? 0;
  const wallInk = isLightWall(color) ? Gallery.ink : Gallery.paper;
  const available = wall.selections.filter((item) => !hiddenIds.includes(item.localId) && !wall.draft?.items.some((piece) => piece.saveLocalId === item.localId));
  const failedSave = !!wall.layoutDraft && !!wall.error;
  const blocked = wall.pending || failedSave;
  useEffect(() => {
    const piece = pieces.find((item) => item.localId === revealId.current);
    if (!piece || !width) return;
    const frame = requestAnimationFrame(() => {
      scroll.current?.scrollTo({ y: Math.max(0, wallTop.current + piece.layout.y * width - controlsHeight.current - 24), animated: false });
      revealId.current = undefined;
    });
    return () => cancelAnimationFrame(frame);
  }, [pieces, width]);
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
    changeEditing(true);
    if (!failedSave) { wall.setError(undefined); void wall.loadSelections(true); }
  }
  function discard() {
    wall.repository.discardDrafts(); wall.setError(undefined); setSelectedId(undefined); setOptions(false); setPhotoPicker(undefined);
  }
  async function publish() {
    const snapshot = wall.repository.getSnapshot();
    if (snapshot.pending || !snapshot.layoutDraft) return;
    const session = captureOwner();
    wall.setError(undefined);
    try {
      // Layers are reassigned by order because a piece hung while a removal was pending took the layer of a visible one.
      wall.repository.setLayoutDraft({ ...snapshot.layoutDraft,
        items: snapshot.layoutDraft.items.filter((item) => !hiddenIds.includes(item.saveLocalId)).map((item, layer) => ({ ...item, layout: { ...item.layout, layer } })),
      });
      await wall.repository.publishLayout();
    }
    catch (cause) {
      if (!session.isCurrent() || !wall.repository.getSnapshot().layoutDraft) return;
      setOptions(false); setPhotoPicker(undefined);
      wall.setError(convexErrorCode(cause) === 'conflict'
        ? 'Your wall changed on another device. Retry saving to keep your edits, or discard them to use the latest wall.'
        : 'Your wall change was not saved. Check your connection, then retry or discard this change.');
    }
  }
  function commit(draft: WallDraft) {
    if (blocked || wall.repository.getSnapshot().pending || !wall.repository.getSnapshot().acknowledged) return;
    wall.repository.setLayoutDraft(draft);
    void publish();
  }
  function move(id: string, layout: WallLayout) {
    if (!wall.draft || blocked) return;
    commit({ ...wall.draft, items: wall.draft.items.map((item) => item.placementId === id
      ? { ...item, layout: constrainLayout(item.layout, layout) } : item) });
  }
  function remove(id: string) {
    if (!wall.draft || blocked) return;
    commit(removeWallPiece(wall.draft, id)); setSelectedId(undefined); setOptions(false);
  }
  function add(localId: string, chosenPhotoId?: string): boolean {
    if (!wall.draft || blocked || count >= LIMITS.wallItems) return false;
    const placementId = randomUUID();
    revealId.current = placementId;
    const photoLocalId = chosenPhotoId ?? selectArtworkPhotos(localId).all().find((photo) => photo.kind !== 'label')?.localId;
    const layout = nextWallLayout(pieces);
    if (chosenPhotoId && selected?.saveLocalId === localId) layout.frame = selected.layout.frame;
    commit({ ...wall.draft, items: [...wall.draft.items, { placementId, photoLocalId, saveLocalId: localId, layout }] });
    setSelectedId(placementId);
    return true;
  }

  return <GestureHandlerRootView style={styles.root}>
    <ScrollView ref={scroll} contentContainerStyle={{ flexGrow: 1 }} scrollEnabled={!wall.pending} stickyHeaderIndices={[header ? 1 : 0]}
      refreshControl={wall.signedIn && !editing ? <RefreshControl refreshing={wall.loading} tintColor={Gallery.accent} onRefresh={() => { void wall.refresh(); }} /> : undefined}>
    {header}
    <View onLayout={(event) => { controlsHeight.current = event.nativeEvent.layout.height; }} style={{ backgroundColor: Gallery.paper }}>{controls}
    <View style={styles.toolbar}>
      <GalleryButton label="All artworks" icon="list.bullet" disabled={blocked}
        onPress={() => { changeEditing(false); setSelectedId(undefined); router.push('/all-artworks'); }} />
      <GalleryButton label={wall.pending ? 'Saving…' : editing ? 'Done' : 'Edit wall'} icon={editing ? undefined : 'slider.horizontal.3'}
        disabled={blocked || (!editing && !wall.draft)} onPress={editing ? () => { changeEditing(false); setSelectedId(undefined); } : edit} />
    </View>
    </View>
    {editing && <Text style={styles.publicNotice}>Changes to your wall are public. They don’t create feed posts.</Text>}
    {editing && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 52 }} contentContainerStyle={styles.swatches}>
      <Text style={styles.caption}>Wall color</Text>
      {Gallery.colors.map(({ name, value: swatchColor }) => <Pressable key={swatchColor} accessibilityRole="button" accessibilityLabel={`${name} wall`}
        accessibilityState={{ selected: color === swatchColor, disabled: blocked }} disabled={blocked}
        onPress={() => { if (wall.draft) commit({ ...wall.draft, color: swatchColor }); }}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 23, height: 23, borderRadius: 12, backgroundColor: swatchColor, borderWidth: color === swatchColor ? 2 : 0.5, borderColor: Gallery.ink, outlineWidth: color === swatchColor ? 2 : 0, outlineOffset: 3, outlineColor: Gallery.paper }} />
      </Pressable>)}
    </ScrollView>}
    {wall.error && <View style={styles.error}><Text accessibilityRole="alert" style={styles.caption}>{wall.error}</Text>
      {failedSave ? <View style={styles.trayHeading}>
        <GalleryButton label="Retry saving" disabled={wall.pending} onPress={() => { void publish(); }} />
        <GalleryButton label="Discard unsaved change" disabled={wall.pending} onPress={discard} />
      </View> : <GalleryButton label="Try again" onPress={() => { void wall.refresh(); }} />}</View>}
      <View accessibilityLabel="Collection wall" onLayout={(event) => { setWidth(event.nativeEvent.layout.width); wallTop.current = event.nativeEvent.layout.y; }}>
        {width > 0 && <WallGallery pieces={pieces} color={color} width={width} editing={editing && !blocked}
          selectedId={selectedId} onRemove={remove} onMove={move} onSelect={(piece) => {
            if (editing) setSelectedId(piece.localId);
            else if (works.some((work) => work.localId === piece.saveLocalId)) router.push({ pathname: '/saved/[savedId]', params: { savedId: piece.saveLocalId!, photoId: piece.photoLocalId } });
            else { setSelectedId(piece.localId); setOptions(true); }
          }}>
          {!count && <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: wallInk }]}>{wall.loading ? 'Opening your wall…' : 'Your own little museum.'}</Text>
            <Text style={[styles.emptyCaption, { color: wallInk }]}>{!wall.signedIn ? 'A place for the art that stays with you. Sign in to curate your public wall.'
              : wall.profileRequired ? 'Create a profile, then choose the art you’d like to show.' : editing ? 'Tap a saved artwork below to hang it.' : 'Hang a few favorites. Make this space yours.'}</Text>
            {wall.loading ? <ActivityIndicator color={wallInk} /> : !wall.signedIn ? <GalleryButton label="Sign in" capsule inverse={!isLightWall(color)} variant="filled" onPress={() => router.push(signInRoute('wall'))} />
              : wall.profileRequired ? <GalleryButton label="Create your wall" inverse={!isLightWall(color)} variant="filled" onPress={() => setProfile(true)} />
                : !editing && wall.draft ? <GalleryButton label="Curate your wall" variant="filled" inverse={!isLightWall(color)} onPress={edit} /> : !editing ? <GalleryButton label="Load wall" onPress={() => { void wall.refresh(); }} /> : null}
          </View>}
        </WallGallery>}
      </View>
      {!editing && <Text style={styles.footer}>Your wall is public. Visits and private notes stay separate.</Text>}
    </ScrollView>
    {editing && <View style={[styles.tray, { paddingBottom: BottomTabInset + insets.bottom }]}>
      {selected ? <>
        <View style={styles.trayHeading}><GalleryButton label="All saved art" icon="chevron.left" onPress={() => setSelectedId(undefined)} />
          <GalleryButton label="Size & position" onPress={() => setOptions(true)} disabled={blocked} /></View>
        <Text style={[styles.caption, { paddingHorizontal: 18 }]}>Frame for {selected.artwork.title}</Text>
        <WallFramePicker value={selected.layout.frame} disabled={blocked} onChange={(frame) => move(selected.localId, { ...selected.layout, frame })} />
        <View style={styles.trayHeading}><GalleryButton label="Choose photo" icon="photo" disabled={blocked} onPress={() => setPhotoPicker('choose')} />
          <GalleryButton label="Hang another photo" icon="plus" disabled={blocked || count >= LIMITS.wallItems} onPress={() => setPhotoPicker('duplicate')} /></View>
      </> : <>
        <Text style={[styles.caption, { paddingHorizontal: 18, paddingTop: 12 }]}>Not on the wall ({available.length})</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 18, padding: 18, alignItems: 'center' }}>
          {available.map((item) => <Pressable key={item.localId} accessibilityRole="button" accessibilityLabel={`Hang ${item.snapshot.title}`}
            disabled={blocked || count >= LIMITS.wallItems} onPress={() => { if (add(item.localId)) showToast('Selected image added to your wall. Other photos stay private.'); }} style={{ width: 66, alignItems: 'center', gap: 7 }}>
            <WallFrame frame="gilt" width={54}><SavedWorkImage path={works.find((work) => work.localId === item.localId)?.cropPath ?? null} title={item.snapshot.title} contain style={{ width: 46, height: 49 }} /></WallFrame>
            <Text numberOfLines={1} style={{ fontSize: 10, color: Gallery.muted }}>{item.snapshot.artist}</Text>
          </Pressable>)}
          {wall.loadingSelections ? <ActivityIndicator color={Gallery.accent} /> : wall.cursor !== null ? <GalleryButton label="More artworks" disabled={blocked} onPress={() => { void wall.loadSelections(); }} />
            : !available.length ? <Text style={styles.caption}>{works.length ? 'Everything is on the wall.' : 'Save an artwork to add it to your wall.'}</Text> : null}
        </ScrollView>
      </>}
    </View>}
    {photoPicker && selected?.saveLocalId && <WallPhotoSheet savedId={selected.saveLocalId} title={selected.artwork.title} photoId={selected.photoLocalId} duplicate={photoPicker === 'duplicate'}
      onDismiss={() => setPhotoPicker(undefined)} onConfirm={(photoLocalId) => {
        if (photoPicker === 'duplicate') { if (add(selected.saveLocalId!, photoLocalId)) showToast('Another placement, still one artwork. Only this photo is public.'); }
        else if (wall.draft && !blocked) {
          commit({ ...wall.draft, items: wall.draft.items.map((item) => item.placementId === selected.localId ? { ...item, photoLocalId } : item) });
          showToast('Wall photo updated. Other photos remain private.');
        }
        setPhotoPicker(undefined);
      }} />}
    {options && selected && <WallArtworkSheet piece={selected} editing={editing} disabled={blocked} color={color} onDismiss={() => setOptions(false)} onChange={(layout) => move(selected.localId, layout)} onRemove={() => remove(selected.localId)} />}
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
  footer: { fontSize: 11, lineHeight: 17, color: Gallery.muted, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 30 },
  publicNotice: { fontSize: 11, lineHeight: 17, color: '#44573D', backgroundColor: '#DEE5D5', paddingHorizontal: 18, paddingVertical: 10 },
  tray: { backgroundColor: Gallery.paper, borderTopWidth: 0.5, borderTopColor: Gallery.separator },
  trayHeading: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12 },
});
