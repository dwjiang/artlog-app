import { randomUUID } from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type Ref } from "react";
import { Image, StyleSheet, View, type ScrollView } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/empty-state";
import { EmptyFrames } from "@/components/empty-state-art";
import { LoadingRing } from "@/components/loading-ring";
import { WallSkeleton } from "@/components/loading-skeleton";
import { usePaneRoom, type PaneRoom } from "@/components/pane-scroll";
import { usePullToRefresh } from "@/components/pull-to-refresh";
import { useHideTabBar } from "@/components/tab-bar-visibility";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { selectArtworkPhotos } from "@/db/repos/artwork-album";
import type { SavedWork } from "@/db/schema";
import { captureOwner, useLocalOwner } from "@/lib/account/owner-store";
import { captureFileUri } from "@/lib/files/photos";
import { convexErrorCode } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { canHangArtwork, type LibraryVisit } from "@/lib/wall/artwork-library";
import { useCollectionWall } from "@/lib/wall/use-collection-wall";
import {
  constrainWallPiece,
  isLightWall,
  nextWallLayout,
  removeWallPiece,
  type WallDraft,
  type WallLayout,
  type WallPiece,
  type Wallpaper,
} from "@/lib/wall/wall-layout";
import { LIMITS } from "@/shared/journal/limits";
import { DEFAULT_WALL_COLOR } from "@/shared/wall/defaults";

import { GalleryButton } from "./gallery-button";
import { WallArtworkPicker } from "./wall-artwork-picker";
import { WallEditorPalette } from "./wall-editor-palette";
import { WallGallery } from "./wall-gallery";
import { WallProfileSheet } from "./wall-profile-sheet";
import { WallArtworkSheet } from "./wall-sheets";
import { wallpaperStyle } from "./wallpaper";
import { WallpaperEditor } from "./wallpaper-editor";

type CollectionWallProps = {
  works: SavedWork[];
  visits?: LibraryVisit[];
  collectionLoading?: boolean;
  collectionError?: string;
  hiddenIds?: string[];
  onEditingChange?: (editing: boolean) => void;
  header?: ReactElement;
  controls?: ReactElement;
  paneRef?: Ref<PaneRoom>;
};
export function CollectionWall({ works, ...props }: CollectionWallProps) {
  const wall = useCollectionWall(works);
  const owner = useLocalOwner();
  return <CollectionWallContent key={owner} works={works} {...props} wall={wall} />;
}

export function CollectionWallContent({
  works,
  visits,
  collectionLoading,
  collectionError,
  hiddenIds = [],
  onEditingChange,
  wall,
  header,
  controls,
  paneRef,
}: CollectionWallProps & { wall: ReturnType<typeof useCollectionWall> }) {
  const router = useRouter();
  const owner = useLocalOwner();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [width, setWidth] = useState(0);
  useHideTabBar(editing);
  const [canvasTop, setCanvasTop] = useState(0);
  const [paletteHeight, setPaletteHeight] = useState(0);
  const [profile, setProfile] = useState(false);
  const [options, setOptions] = useState(false);
  // Wallpaper remains a preview until Done; artwork edits save as they happen.
  const [wallpaperPreview, setWallpaperPreview] = useState<Wallpaper>();
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const [picker, setPicker] = useState<string[]>();
  const [selectedId, setSelectedId] = useState<string>();
  const scroll = useAnimatedRef<ScrollView>();
  const room = usePaneRoom(scroll, paneRef);
  const scrollGesture = useMemo(() => Gesture.Native(), []);
  const wallTop = useRef(0);
  const controlsHeight = useRef(0);
  const revealId = useRef<string | undefined>(undefined);
  const pieces = wall.pieces.filter((piece) => !hiddenIds.includes(piece.saveLocalId ?? piece.localId));
  const selected = pieces.find((piece) => piece.localId === selectedId);
  const wallpaper = wallpaperPreview ?? {
    color: wall.draft?.color ?? DEFAULT_WALL_COLOR,
    pattern: wall.draft?.pattern,
  };
  const { color } = wallpaper;
  const count = wall.draft?.items.filter((item) => !hiddenIds.includes(item.saveLocalId)).length ?? 0;
  const opening = wall.loading && !wall.draft && !wall.error;
  const blank = !wall.draft?.items.length && !editing && !opening && !wall.error;
  const hasSavedArt = works.some((work) => work.owner === owner && !hiddenIds.includes(work.localId));
  const wallInk = isLightWall(color) ? Gallery.ink : Gallery.paper;
  // The gap a pull opens under the controls shows the wall color, so the spinner takes the wall's ink.
  const pull = usePullToRefresh(scroll, {
    enabled: wall.signedIn && !editing,
    onRefresh: () => wall.refresh(),
    tintColor: wallInk,
  });
  const available = works.filter((item) => item.owner === owner && !hiddenIds.includes(item.localId));
  const failedSave = !!wall.layoutDraft && !!wall.error;
  const blocked = wall.pending || failedSave || adding;
  useEffect(() => {
    const piece = pieces.find((item) => item.localId === revealId.current);
    if (!piece || !width) return;
    const frame = requestAnimationFrame(() => {
      scroll.current?.scrollTo({
        y: Math.max(0, wallTop.current + piece.layout.y * width - (editing ? 0 : controlsHeight.current) - 24),
        animated: false,
      });
      revealId.current = undefined;
    });
    return () => cancelAnimationFrame(frame);
  }, [pieces, width, editing, scroll]);
  // Detail screens edit the wall through their own repository, so each return to this screen re-reads it. The memoized
  // callback reads the repository and a ref so the first load (owned by the hook) and edits in progress are skipped
  // without re-running.
  const editingRef = useRef(false);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  useFocusEffect(
    useCallback(() => {
      if (wall.repository.getSnapshot().acknowledged && !editingRef.current) {
        void wall.refresh();
      }
      // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [wall.repository]),
  );

  function changeEditing(value: boolean) {
    setEditing(value);
    onEditingChange?.(value);
  }
  function edit() {
    if (!wall.draft) return;
    changeEditing(true);
    if (!failedSave) {
      wall.setError(undefined);
    }
  }
  function discard() {
    wall.repository.discardDrafts();
    wall.setError(undefined);
    setSelectedId(undefined);
    setOptions(false);
  }
  async function publish() {
    const snapshot = wall.repository.getSnapshot();
    if (snapshot.pending || !snapshot.layoutDraft) return;
    const session = captureOwner();
    wall.setError(undefined);
    try {
      // Layers are reassigned by order because a piece hung while a removal was pending took the layer of a visible one.
      wall.repository.setLayoutDraft({
        ...snapshot.layoutDraft,
        items: snapshot.layoutDraft.items
          .filter((item) => !hiddenIds.includes(item.saveLocalId))
          .map((item, layer) => ({
            ...item,
            layout: { ...item.layout, layer },
          })),
      });
      await wall.repository.publishLayout();
    } catch (cause) {
      if (!session.isCurrent() || !wall.repository.getSnapshot().layoutDraft) {
        return;
      }
      reportError(cause, "wall.layout.publish");
      setOptions(false);
      wall.setError(
        convexErrorCode(cause) === "conflict"
          ? "Your wall changed on another device. Retry saving to keep your edits, or discard them to use the latest wall."
          : "Your wall change was not saved. Check your connection, then retry or discard this change.",
      );
    }
  }
  function commit(draft: WallDraft) {
    if (blocked || wall.repository.getSnapshot().pending || !wall.repository.getSnapshot().acknowledged) {
      return;
    }
    wall.repository.setLayoutDraft(draft);
    void publish();
  }
  function move(id: string, layout: WallLayout) {
    if (!wall.draft || blocked) return;
    const piece = pieces.find((item) => item.localId === id);
    if (!piece) return;
    const next = constrainWallPiece(piece, layout, pieces, width);
    if (
      next.x === piece.layout.x
      && next.y === piece.layout.y
      && next.width === piece.layout.width
      && next.frame === piece.layout.frame
    ) {
      return;
    }
    commit({
      ...wall.draft,
      items: wall.draft.items.map((item) => (item.placementId === id ? { ...item, layout: next } : item)),
    });
  }
  function remove(id: string) {
    if (!wall.draft || blocked) return;
    commit(removeWallPiece(wall.draft, id));
    setSelectedId(undefined);
    setOptions(false);
  }
  function openPicker() {
    setPicker([]);
  }
  async function addSelection() {
    if (!wall.draft || !picker?.length || blocked || addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    const session = captureOwner();
    try {
      const choices = available.filter((work) => picker.includes(work.localId) && canHangArtwork(work, wall.signedIn));
      const aspects = await Promise.all(
        choices.map(async (work) => {
          if (!work.cropPath) return undefined;
          try {
            const { width, height } = await Image.getSize(captureFileUri(work.cropPath));
            return width > 0 && height > 0 ? width / height : undefined;
          } catch {
            return undefined;
          }
        }),
      );
      if (!session.isCurrent()) return;
      const nextPieces: WallPiece[] = [...pieces];
      const items = [...wall.draft.items];
      let firstPlacement: string | undefined;
      for (const [index, selection] of choices.entries()) {
        const { localId } = selection;
        if (!selection || items.some((item) => item.saveLocalId === localId) || items.length >= LIMITS.wallItems) {
          continue;
        }
        const placementId = randomUUID();
        firstPlacement ??= placementId;
        const layout = nextWallLayout(nextPieces, width || undefined);
        const photoLocalId = selectArtworkPhotos(localId)
          .all()
          .find((photo) => photo.kind !== "label")?.localId;
        items.push({ placementId, saveLocalId: localId, photoLocalId, layout });
        nextPieces.push({
          localId: placementId,
          saveLocalId: localId,
          layout,
          cropAspectRatio: aspects[index],
          artwork: {
            title: selection.title,
            artist: selection.artist,
            media: { kind: "placeholder", width: 1, height: 1 },
          },
        });
      }
      revealId.current = firstPlacement;
      setSelectedId(firstPlacement);
      commit({ ...wall.draft, items });
      setPicker(undefined);
      changeEditing(true);
    } catch (cause) {
      reportError(cause, "wall.artworks.add");
      wall.setError("Artworks could not be added. Try again.");
      setPicker(undefined);
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }

  function applyWallpaper() {
    if (wall.draft && wallpaperPreview) {
      const { color: nextColor, pattern } = wallpaperPreview;
      if (nextColor !== wall.draft.color || pattern !== wall.draft.pattern) {
        commit({ ...wall.draft, color: nextColor, pattern });
      }
    }
    setWallpaperPreview(undefined);
  }

  function finishEditing() {
    changeEditing(false);
    setSelectedId(undefined);
    setOptions(false);
  }

  return (
    <GestureHandlerRootView style={[styles.root, { backgroundColor: color }]}>
      {editing && (
        <View style={[styles.toolbar, { backgroundColor: Gallery.paper }]}>
          <Text variant="section" accessibilityRole="header">
            Edit wall
          </Text>
          <GalleryButton
            label="Done"
            variant="filled"
            size="compact"
            busy={wall.pending}
            disabled={blocked}
            onPress={wallpaperPreview ? applyWallpaper : finishEditing}
          />
        </View>
      )}
      <GestureDetector gesture={scrollGesture}>
        <Animated.ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ flexGrow: 1, minHeight: editing ? undefined : room.minHeight }}
          scrollEnabled={!wall.pending}
          stickyHeaderIndices={editing ? undefined : [header ? 1 : 0]}
          onLayout={room.onLayout}
          onScroll={room.onScroll}
          refreshControl={pull.refreshControl}
        >
          {/* Raised over the paper strip at the end, which would cover the header while a pull holds it up. */}
          {!editing && header && <Animated.View style={[{ zIndex: 1 }, pull.headerStyle]}>{header}</Animated.View>}
          {!editing && (
            <View
              onLayout={(event) => {
                controlsHeight.current = event.nativeEvent.layout.height;
                pull.onHeaderLayout(event);
                room.onPinnedLayout(event);
              }}
            >
              <Animated.View style={[{ backgroundColor: Gallery.paper }, pull.headerStyle]}>
                {controls}
                <View style={styles.toolbar}>
                  {wall.draft && (
                    <GalleryButton
                      label="Edit wall"
                      icon="slider.horizontal.3"
                      disabled={blocked || !wall.draft}
                      onPress={edit}
                    />
                  )}
                  <View style={styles.toolbarTrailing}>
                    {wall.loading && wall.draft && !wall.error && !pull.refreshing && (
                      <LoadingRing accessibilityLabel="Refreshing wall" />
                    )}
                    <GalleryButton
                      label="All artworks"
                      icon="chevron.right"
                      iconPosition="trailing"
                      disabled={blocked}
                      onPress={() => router.push("/all-artworks")}
                    />
                  </View>
                </View>
              </Animated.View>
            </View>
          )}
          {wall.error && (
            <View style={styles.error}>
              <Text accessibilityRole="alert" style={styles.caption}>
                {wall.error}
              </Text>
              {failedSave ? (
                <View style={styles.trayHeading}>
                  <GalleryButton
                    label="Retry saving"
                    disabled={wall.pending}
                    onPress={() => {
                      void publish();
                    }}
                  />
                  <GalleryButton label="Discard unsaved change" disabled={wall.pending} onPress={discard} />
                </View>
              ) : (
                <GalleryButton
                  label="Try again"
                  onPress={() => {
                    void wall.refresh();
                  }}
                />
              )}
            </View>
          )}
          {opening ? (
            <WallSkeleton label="Opening your wall…" />
          ) : blank ? (
            <View style={[styles.blankWall, wallpaperStyle(wallpaper)]}>
              <View style={styles.emptyPaper}>
                <EmptyState
                  title="No artworks on your wall yet."
                  detail={
                    hasSavedArt
                      ? `Choose saved artworks for your ${wall.signedIn ? "public wall" : "wall"}.`
                      : "Scan an artwork to add it to your collection."
                  }
                  footnote={wall.signedIn ? undefined : "Your wall stays private on this iPhone until you sign in."}
                  visual={<EmptyFrames />}
                >
                  <GalleryButton
                    label={
                      !wall.draft && !wall.profileRequired
                        ? "Load wall"
                        : hasSavedArt
                          ? "Choose artworks"
                          : "Scan artwork"
                    }
                    variant="filled"
                    fullWidth
                    onPress={() => {
                      if (!wall.draft && !wall.profileRequired) void wall.refresh();
                      else if (!hasSavedArt) router.navigate("/scan");
                      // The wall is public, so its profile is created only once there is art to hang.
                      else if (wall.profileRequired) setProfile(true);
                      else openPicker();
                    }}
                  />
                </EmptyState>
              </View>
            </View>
          ) : (
            <View
              accessibilityLabel="Collection wall"
              style={{ flexGrow: 1 }}
              onLayout={(event) => {
                setWidth(event.nativeEvent.layout.width);
                wallTop.current = event.nativeEvent.layout.y;
                setCanvasTop(event.nativeEvent.layout.y);
              }}
            >
              {width > 0 && (
                <WallGallery
                  pieces={pieces}
                  wallpaper={wallpaper}
                  width={width}
                  minHeight={Math.max(280, room.viewport + (editing ? 0 : room.pinned) - canvasTop)}
                  bottomInset={editing && !wallpaperPreview ? paletteHeight + insets.bottom : 0}
                  backgroundBottomInset={insets.bottom}
                  editing={editing && !blocked && !wallpaperPreview}
                  scrollGesture={scrollGesture}
                  selectedId={selectedId}
                  onDeselect={() => setSelectedId(undefined)}
                  onMove={move}
                  onSelect={(piece) => {
                    if (editing && !wallpaperPreview) {
                      setSelectedId(piece.localId);
                    } else if (!editing && works.some((work) => work.localId === piece.saveLocalId)) {
                      router.push({
                        pathname: "/saved/[savedId]",
                        params: {
                          savedId: piece.saveLocalId!,
                          photoId: piece.photoLocalId,
                        },
                      });
                    } else if (!editing) {
                      setSelectedId(piece.localId);
                      setOptions(true);
                    }
                  }}
                >
                  {!count && (
                    <View style={styles.empty}>
                      {!opening && (
                        <Text variant="display" style={[styles.emptyTitle, { color: wallInk }]}>
                          No artworks on your wall yet.
                        </Text>
                      )}
                      {!opening && (
                        <Text style={[styles.emptyCaption, { color: wallInk }]}>
                          {editing ? "Choose Add art to hang your first artwork." : "Choose from your saved artworks."}
                        </Text>
                      )}
                      {opening ? (
                        <LoadingRing color={wallInk} accessibilityLabel="Opening your wall…" />
                      ) : !editing && wall.draft ? (
                        <GalleryButton
                          label="Add artworks"
                          variant="filled"
                          inverse={!isLightWall(color)}
                          onPress={edit}
                        />
                      ) : !editing ? (
                        <GalleryButton
                          label="Load wall"
                          onPress={() => {
                            void wall.refresh();
                          }}
                        />
                      ) : null}
                    </View>
                  )}
                </WallGallery>
              )}
            </View>
          )}
          {/* The root carries the wall color so bottom overscroll continues the wall; the header above it is paper, so top overscroll stays paper too. */}
          <View pointerEvents="none" style={styles.topOverscroll} />
        </Animated.ScrollView>
      </GestureDetector>
      {editing
        && (wallpaperPreview ? (
          <View style={styles.tray}>
            <WallpaperEditor value={wallpaperPreview} onChange={setWallpaperPreview} />
          </View>
        ) : (
          <View
            pointerEvents="box-none"
            accessibilityElementsHidden={!!options || !!picker}
            onLayout={(event) => setPaletteHeight(event.nativeEvent.layout.height)}
            style={[styles.palette, { bottom: Math.max(insets.bottom, 12) }]}
          >
            <WallEditorPalette
              selected={selected}
              disabled={blocked}
              onAdd={openPicker}
              onWallpaper={() => setWallpaperPreview(wallpaper)}
              onFrame={() => setOptions(true)}
              onRemove={() => selected && remove(selected.localId)}
            />
          </View>
        ))}
      {picker && (
        <WallArtworkPicker
          works={available}
          visits={visits}
          pieces={pieces}
          selectedIds={picker}
          count={count}
          signedIn={wall.signedIn}
          disabled={blocked}
          loading={collectionLoading}
          error={collectionError}
          onChange={setPicker}
          onDismiss={() => setPicker(undefined)}
          onAdd={() => {
            void addSelection();
          }}
        />
      )}
      {options && selected && (
        <WallArtworkSheet
          piece={selected}
          editing={editing}
          disabled={blocked}
          wallpaper={wallpaper}
          onDismiss={() => setOptions(false)}
          onChange={(layout) => move(selected.localId, layout)}
        />
      )}
      {profile && (
        <WallProfileSheet
          onDismiss={() => setProfile(false)}
          onCreated={() => {
            setProfile(false);
            void wall.refresh();
          }}
        />
      )}
    </GestureHandlerRootView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  topOverscroll: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: "100%",
    height: 1000,
    backgroundColor: Gallery.paper,
  },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    minHeight: 52,
  },
  toolbarTrailing: { flexDirection: "row", alignItems: "center", gap: 12 },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  error: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Gallery.fill,
  },
  emptyPaper: {
    backgroundColor: Gallery.paper,
    borderRadius: 12,
    flexGrow: 1,
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  },
  blankWall: {
    flexGrow: 1,
    padding: 20,
    minHeight: 360,
    borderTopWidth: 0.5,
    borderTopColor: Gallery.separator,
  },
  empty: {
    minHeight: 440,
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  emptyTitle: { textAlign: "center" },
  emptyCaption: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 280,
    opacity: 0.85,
  },
  palette: { position: "absolute", right: 16 },
  tray: {
    backgroundColor: Gallery.paper,
    borderTopWidth: 0.5,
    borderTopColor: Gallery.separator,
  },
  trayHeading: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
});
