import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Gallery, Spacing } from '@/constants/theme';
import type { SavedWork } from '@/db/schema';
import { useCollectionWall } from '@/lib/wall/use-collection-wall';
import { constrainLayout, isLightWall, nextWallLayout, removeWallPiece, type WallLayout, type WallPiece } from '@/lib/wall/wall-layout';
import { socialErrorMessage } from '@/shared/social/errors';
import { LIMITS } from '@/shared/journal/limits';
import { convexErrorCode } from '@/lib/network-error';
import { GalleryButton } from './gallery-button';
import { WallArtworkSheet, WallArtworkSummary, WallSheet, wallSheetStyles } from './wall-sheets';
import { WallProfileSheet } from './wall-profile-sheet';
import { WallGallery } from './wall-gallery';
import { WallColorPicker } from './wall-options';
import { SavedWorkImage } from './saved-work-image';
import { ViewModePicker, type ViewMode } from './view-mode-picker';

export function CollectionWall({ works, onModeChange }: { works: SavedWork[]; onModeChange: (mode: ViewMode) => void }) {
  const wall = useCollectionWall(works);
  return <CollectionWallContent works={works} onModeChange={onModeChange} wall={wall} />;
}

export function CollectionWallContent({ works, onModeChange, wall }: {
  works: SavedWork[]; onModeChange: (mode: ViewMode) => void; wall: ReturnType<typeof useCollectionWall>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [width, setWidth] = useState(0);
  const [sheet, setSheet] = useState<'add' | 'color' | 'profile' | 'visitor'>();
  const [selectedId, setSelectedId] = useState<string>();
  const [visitorPiece, setVisitorPiece] = useState<WallPiece>();
  const selected = wall.pieces.find((piece) => piece.localId === selectedId);
  const color = wall.draft?.color ?? Gallery.sage;
  const count = wall.draft?.items.length ?? 0;
  const wallInk = isLightWall(color) ? Gallery.ink : Gallery.paper;
  const available = wall.selections.filter((item) => !wall.draft?.items.some((hung) => hung.saveLocalId === item.localId));

  function edit() {
    if (!wall.draft) return;
    wall.repository.setLayoutDraft(wall.draft);
    wall.setError(undefined); setEditing(true);
  }
  function cancel() {
    wall.repository.discardDrafts(); wall.setError(undefined); setEditing(false); setSelectedId(undefined); setSheet(undefined);
  }
  async function publish() {
    if (wall.pending) return;
    wall.setError(undefined);
    try { await wall.repository.publishLayout(); setEditing(false); }
    catch (cause) {
      wall.setError(convexErrorCode(cause) === 'conflict'
        ? 'Another device changed your wall. Publish again to use your edits, or Cancel to see the latest wall.'
        : socialErrorMessage(cause) ?? 'Your wall was not published. Check your connection and try again.');
    }
  }
  function move(id: string, layout: WallLayout) {
    if (!wall.draft || wall.pending) return;
    wall.repository.setLayoutDraft({ ...wall.draft, items: wall.draft.items.map((item) => item.saveLocalId === id
      ? { ...item, layout: constrainLayout(item.layout, layout) } : item) });
  }
  function add(localId: string) {
    if (!wall.draft || count >= LIMITS.wallItems || wall.draft.items.some((item) => item.saveLocalId === localId)) return;
    wall.repository.setLayoutDraft({ ...wall.draft, items: [...wall.draft.items, { saveLocalId: localId, layout: nextWallLayout(wall.pieces) }] });
  }
  function openAdd() { setSheet('add'); void wall.loadSelections(true); }
  function select(piece: WallPiece) {
    if (!editing && works.some((work) => work.localId === piece.localId)) {
      router.push({ pathname: '/[savedId]', params: { savedId: piece.localId } });
    } else setSelectedId(piece.localId);
  }

  return <GestureHandlerRootView style={styles.root}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1 }}
      refreshControl={wall.signedIn && !editing ? <RefreshControl refreshing={wall.loading} tintColor={Gallery.accent}
        onRefresh={() => { void wall.refresh(); }} /> : undefined}>
      <View style={styles.controls}>
        <ViewModePicker mode="wall" onChange={onModeChange} disabled={editing} />
        <View style={styles.toolRow}>
          <Text style={styles.eyebrow}>{count} {count === 1 ? 'ARTWORK' : 'ARTWORKS'} ON YOUR WALL</Text>
          <GalleryButton label={editing ? 'Add artwork' : 'All artworks'} icon={editing ? 'plus' : 'list.bullet'}
            onPress={editing ? openAdd : () => onModeChange('grid')} disabled={wall.pending || (editing && count >= LIMITS.wallItems)} />
        </View>
        {editing && <>
          <View style={styles.editRow}>
            <GalleryButton label="Wall color" icon="paintpalette" onPress={() => setSheet('color')} disabled={wall.pending} />
            <Text style={styles.caption}>Hold to move · tap to frame</Text>
          </View>
          <Text style={[styles.caption, { paddingBottom: Spacing.three }]}>Publish when you’re ready. Your visits and private notes stay separate.</Text>
        </>}
      </View>
      {wall.error && <View style={styles.error}>
        <Text accessibilityRole="alert" selectable style={styles.body}>{wall.error}</Text>
        {!editing && <GalleryButton label="Try again" onPress={() => { void wall.refresh(); }} />}
      </View>}
      <View accessibilityLabel="Collection wall" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 && <WallGallery pieces={wall.pieces} color={color} width={width} editing={editing && !wall.pending}
          onSelect={select} onMove={move}>
          {!count && <View style={styles.empty}>
            <Image source="sf:rectangle.3.group" tintColor={wallInk} style={{ width: 70, height: 58 }} />
            <Text style={[styles.emptyTitle, { color: wallInk }]}>{wall.loading ? 'Opening your wall…' : 'Your own little museum.'}</Text>
            <Text style={[styles.emptyCaption, { color: wallInk, opacity: 0.8 }]}>{!wall.signedIn ? 'A place for the art that stays with you. Sign in to curate your public wall.'
              : wall.profileRequired ? 'Create a public profile, then choose the art you’d like to show.'
              : editing ? 'Choose a saved artwork to hang your first piece.'
              : 'Hang a few favorites. Make this space yours.'}</Text>
            {wall.loading ? <ActivityIndicator color={Gallery.accent} />
              : !wall.signedIn ? <GalleryButton label="Sign in" variant="filled" onPress={() => router.push('/settings')} />
              : wall.profileRequired ? <GalleryButton label="Create your wall" variant="filled" onPress={() => setSheet('profile')} />
              : wall.draft ? <GalleryButton label={editing ? 'Choose artwork' : 'Curate your wall'} variant="filled" inverse={!isLightWall(color)}
                onPress={editing ? openAdd : edit} />
              : <GalleryButton label="Load wall" onPress={() => { void wall.refresh(); }} />}
          </View>}
        </WallGallery>}
      </View>
      <View style={styles.footer}>
        <View style={styles.privacy}>
          <Image source="sf:globe" tintColor={Gallery.muted} style={{ width: 15, height: 15, marginTop: 2 }} />
          <Text style={[styles.caption, { flex: 1 }]}>Your wall is public. Visits and private notes stay separate.</Text>
        </View>
        {wall.acknowledged && !editing && <GalleryButton label="View as visitor" icon="arrow.up.right"
          onPress={() => { setVisitorPiece(undefined); setSheet('visitor'); }} />}
      </View>
    </ScrollView>
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button icon={editing ? undefined : 'person.crop.circle'} accessibilityLabel={editing ? 'Cancel editing' : 'Your account'}
        disabled={wall.pending} onPress={editing ? cancel : () => router.push('/settings')} tintColor={Gallery.ink}>
        {editing ? 'Cancel' : 'Your account'}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button hidden={editing} icon="plus" accessibilityLabel="Add visit" onPress={() => router.push('/visit-create')}>Add visit</Stack.Toolbar.Button>
      <Stack.Toolbar.Button hidden={!wall.draft} disabled={wall.pending} onPress={editing ? () => { void publish(); } : edit}
        variant={editing ? 'done' : 'plain'} tintColor={Gallery.ink}>
        {wall.pending ? 'Publishing…' : editing ? 'Publish' : 'Edit'}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>

    {selected && <WallArtworkSheet piece={selected} editing={editing} color={color} onDismiss={() => setSelectedId(undefined)}
      onChange={(layout) => move(selected.localId, layout)} onRemove={() => {
        if (wall.draft) wall.repository.setLayoutDraft(removeWallPiece(wall.draft, selected.localId));
        setSelectedId(undefined);
      }} />}
    {sheet === 'profile' && <WallProfileSheet onDismiss={() => setSheet(undefined)} onCreated={() => { setSheet(undefined); void wall.refresh(); }} />}
    {sheet === 'color' && <WallSheet title="Wall color" onDismiss={() => setSheet(undefined)}>
      <ScrollView contentContainerStyle={wallSheetStyles.section}>
        <Text style={styles.caption}>Set the mood for your collection.</Text>
        <WallColorPicker value={color} onChange={(color) => {
          if (wall.draft) wall.repository.setLayoutDraft({ ...wall.draft, color });
        }} />
      </ScrollView>
    </WallSheet>}
    {sheet === 'add' && <WallSheet title="Add to your wall" onDismiss={() => setSheet(undefined)} tall>
      <FlatList data={available} numColumns={3} columnWrapperStyle={styles.selectionColumns}
        keyExtractor={(item) => item.localId} contentContainerStyle={wallSheetStyles.section}
        ListHeaderComponent={<Text style={styles.caption}>Choose from your synced collection. Private notes won’t be included.</Text>}
        ListEmptyComponent={!wall.loadingSelections ? <Text style={styles.body}>No more artworks to hang. Save a painting from Scan, or let your collection finish syncing.</Text> : null}
        renderItem={({ item }) => <View style={styles.selectionTile}>
          <SavedWorkImage path={works.find((work) => work.localId === item.localId)?.cropPath ?? null}
            title={item.snapshot.title} contain style={styles.selectionImage} />
          <View style={{ minHeight: 49, gap: 3 }}>
            <Text style={styles.selectionTitle} numberOfLines={2}>{item.snapshot.title}</Text>
            <Text style={styles.selectionArtist} numberOfLines={1}>{item.snapshot.artist}</Text>
          </View>
          <GalleryButton label="Hang" icon="plus" onPress={() => add(item.localId)} disabled={count >= LIMITS.wallItems} variant="outlined" fullWidth />
        </View>}
        ListFooterComponent={<View style={{ gap: Spacing.three }}>
          {wall.error && <Text accessibilityRole="alert" style={styles.body}>{wall.error}</Text>}
          {wall.loadingSelections ? <ActivityIndicator color={Gallery.accent} /> : wall.cursor !== null &&
            <GalleryButton label={wall.error ? 'Try again' : 'More artworks'} onPress={() => { void wall.loadSelections(); }} />}
          <Text style={styles.caption}>{count} of {LIMITS.wallItems} places filled</Text>
        </View>} />
    </WallSheet>}
    {sheet === 'visitor' && wall.acknowledged && <WallSheet title="Visitor preview" onDismiss={() => setSheet(undefined)} tall>
      <ScrollView>
        {visitorPiece ? <>
          <GalleryButton label="Back to wall" icon="chevron.left" onPress={() => setVisitorPiece(undefined)} />
          <WallArtworkSummary piece={visitorPiece} color={wall.acknowledged.color} />
          {wall.acknowledged.items.find((item) => item.saveLocalId === visitorPiece.localId)?.note &&
            <View style={wallSheetStyles.section}><Text selectable style={styles.body}>{wall.acknowledged.items.find((item) => item.saveLocalId === visitorPiece.localId)!.note}</Text></View>}
        </> : <>
          <Text style={[styles.caption, { padding: Spacing.four }]}>This is how your published wall looks to a visitor.</Text>
          <WallGallery pieces={wall.acknowledged.items.map((item) => ({ localId: item.saveLocalId, layout: item.layout, artwork: item.artwork }))}
            color={wall.acknowledged.color} width={width} onSelect={setVisitorPiece} />
        </>}
      </ScrollView>
    </WallSheet>}
  </GestureHandlerRootView>;
}

const styles = StyleSheet.create({
  ...wallSheetStyles,
  root: { flex: 1, backgroundColor: Gallery.paper },
  controls: { paddingHorizontal: 18, paddingTop: 12 },
  toolRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, minHeight: 61, paddingTop: 8, paddingBottom: 9 },
  eyebrow: { flex: 1, fontSize: 10, lineHeight: 16, fontWeight: '500', letterSpacing: 1.1, color: Gallery.muted },
  editRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  empty: { flex: 1, padding: Spacing.five, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  emptyTitle: { fontSize: 24, fontWeight: '600', color: Gallery.ink },
  emptyCaption: { fontSize: 15, lineHeight: 22, color: Gallery.muted, textAlign: 'center', maxWidth: 280 },
  footer: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 30, gap: 8, alignItems: 'flex-start' },
  privacy: { flexDirection: 'row', gap: Spacing.two },
  error: { padding: Spacing.three, gap: Spacing.two, backgroundColor: Gallery.fill },
  selectionColumns: { justifyContent: 'space-between', gap: 12 },
  selectionTile: { flex: 1, maxWidth: '31%', gap: 8, paddingVertical: 12 },
  selectionImage: { width: '100%', aspectRatio: 1, backgroundColor: Gallery.fill, borderRadius: 4 },
  selectionTitle: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: Gallery.ink },
  selectionArtist: { fontSize: 10, lineHeight: 14, color: Gallery.muted },
});
