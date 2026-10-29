import { randomUUID } from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type Ref } from "react";
import { Image, StyleSheet, View } from "react-native";
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
import { Gallery, PinnedFooterBorder, Spacing } from "@/constants/theme";
import { selectArtworkPhotos } from "@/db/repos/artwork-album";
import type { SavedWork } from "@/db/schema";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { captureOwner, useLocalOwner } from "@/lib/account/owner-store";
import { captureFileUri } from "@/lib/files/photos";
import { convexErrorCode } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { useHorizontalSafeAreaPadding } from "@/lib/ui/safe-area";
import { canHangArtwork, type LibraryVisit } from "@/lib/wall/artwork-library";
import { useCollectionWall } from "@/lib/wall/use-collection-wall";
import {
  arrangeWall,
  isLightWall,
  nextWallLayout,
  removeWallPiece,
  type WallArrangement,
  type WallDraft,
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
import { WallTopEdge, useWallScrollEdge } from "./wall-scroll-edge";
import { WallArtworkSheet } from "./wall-sheets";
import { WallToolbar } from "./wall-toolbar";
import { WallpaperEditor } from "./wallpaper-editor";

// Each return to the tab re-reads the wall; a re-read that settles within this delay shows no spinner, so the toolbar
// holds still.
const REFRESH_INDICATOR_DELAY_MS = 500;

type CollectionWallProps = {
  works: SavedWork[];
  visits?: LibraryVisit[];
  collectionLoading?: boolean;
  collectionError?: string;
  onCollectionRetry?: () => void;
  hiddenIds?: string[];
  onEditingChange?: (editing: boolean) => void;
  header?: ReactElement;
  controls?: ReactElement;
  paneRef?: Ref<PaneRoom>;
  /** Whether this pane is on screen; only then may a dark wall turn the status bar light. */
  shown?: boolean;
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
  onCollectionRetry,
  hiddenIds = [],
  onEditingChange,
  wall,
  header,
  controls,
  paneRef,
  shown = true,
}: CollectionWallProps & { wall: ReturnType<typeof useCollectionWall> }) {
  const router = useRouter();
  const owner = useLocalOwner();
  const insets = useSafeAreaInsets();
  const sides = useHorizontalSafeAreaPadding();
  const editBarPadding = useHorizontalSafeAreaPadding(styles.toolbar);
  const errorPadding = useHorizontalSafeAreaPadding(styles.error);
  const blankPadding = useHorizontalSafeAreaPadding(styles.blank);
  const [editing, setEditing] = useState(false);
  const [wallWidth, setWallWidth] = useState(0);
  // Artworks hang beside side bars (the iPhone Duo's rail, the camera housing in landscape), not under them.
  const width = wallWidth && wallWidth - insets.left - insets.right;
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
  const scroll = useAnimatedRef<Animated.ScrollView>();
  const scrollGesture = useMemo(() => Gesture.Native(), []);
  const wallTop = useRef(0);
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
  const room = usePaneRoom(scroll, { handle: paneRef, empty: blank });
  const hasSavedArt = works.some((work) => work.owner === owner && !hiddenIds.includes(work.localId));
  const wallInk = isLightWall(color) ? Gallery.ink : Gallery.paper;
  const canvas = !opening && !blank;
  const { edge, darkTop } = useWallScrollEdge(scroll, color, !isLightWall(color));
  const focused = useIsFocused();
  const pull = usePullToRefresh({ enabled: wall.signedIn && !editing, onRefresh: () => wall.refresh() });
  const available = works.filter((item) => item.owner === owner && !hiddenIds.includes(item.localId));
  const failedSave = !!wall.layoutDraft && !!wall.error;
  const blocked = wall.pending || failedSave || adding;
  const refreshing = wall.loading && !!wall.draft && !wall.error && !pull.refreshing;
  const slowRefresh = useDebouncedValue(refreshing, REFRESH_INDICATOR_DELAY_MS, false);
  useEffect(() => {
    const piece = pieces.find((item) => item.localId === revealId.current);
    if (!piece || !width) return;
    const frame = requestAnimationFrame(() => {
      scroll.current?.scrollTo({
        y: Math.max(0, wallTop.current + piece.layout.y * width - 24),
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
      // Reassign layers by order so pieces added during a pending removal cannot share a visible piece's layer.
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
      return false;
    }
    wall.repository.setLayoutDraft(draft);
    void publish();
    return true;
  }
  function arrange(layouts: WallArrangement) {
    if (!wall.draft || blocked) return false;
    const changed = wall.draft.items.some(({ placementId, layout }) => {
      const next = layouts[placementId];
      return (
        next
        && (next.x !== layout.x || next.y !== layout.y || next.width !== layout.width || next.frame !== layout.frame)
      );
    });
    return (
      changed
      && commit({
        ...wall.draft,
        items: wall.draft.items.map((item) =>
          layouts[item.placementId] ? { ...item, layout: layouts[item.placementId] } : item,
        ),
      })
    );
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

  const toolbar = (
    <View style={sides}>
      <WallToolbar
        works={available}
        onEdit={wall.draft ? edit : undefined}
        onAllArtworks={() => router.push("/all-artworks")}
        disabled={blocked}
        refreshing={refreshing && slowRefresh}
      />
    </View>
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      {shown && focused && canvas && !editing && darkTop && <StatusBar style="light" />}
      {editing && (
        <View style={[styles.toolbar, editBarPadding, { backgroundColor: Gallery.paper }]}>
          <Text variant="section" accessibilityRole="header">
            Edit Wall
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
          // Grown to the screen, the content plus the tab bar inset overflows, so a blank wall keeps its own height.
          contentContainerStyle={{ flexGrow: blank ? 0 : 1, minHeight: editing ? undefined : room.minHeight }}
          bounces={!blank || !!pull.refreshControl}
          scrollEnabled={!wall.pending && !opening}
          onLayout={room.onLayout}
          onScroll={room.onScroll}
          refreshControl={pull.refreshControl}
        >
          {!editing && header && <View style={sides}>{header}</View>}
          {!editing && (
            <View style={sides} onLayout={room.onPinnedLayout}>
              {controls}
            </View>
          )}
          {collectionError && (
            <View style={[styles.error, errorPadding]}>
              <Text accessibilityRole="alert" style={styles.caption}>
                {collectionError}
              </Text>
              {onCollectionRetry && <GalleryButton label="Try again" disabled={blocked} onPress={onCollectionRetry} />}
            </View>
          )}
          {wall.error && (
            <View style={[styles.error, errorPadding]}>
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
          {!canvas && !editing && toolbar}
          {opening ? (
            <WallSkeleton label="Opening your wall…" />
          ) : blank ? (
            // The toolbar above already separates the empty state from the pane picker; the full inset would push its
            // action under the tab bar.
            <View style={[styles.blank, blankPadding]}>
              <EmptyState
                inset={false}
                title="No artworks on your wall yet."
                detail={
                  hasSavedArt
                    ? `Choose saved artworks for your ${wall.signedIn ? "public wall" : "wall"}.`
                    : "Scan an artwork to add it to your collection."
                }
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
          ) : (
            <View
              accessibilityLabel="Collection wall"
              style={{ flexGrow: 1 }}
              onLayout={(event) => {
                setWallWidth(event.nativeEvent.layout.width);
                wallTop.current = event.nativeEvent.layout.y;
                edge.wallTop.set(event.nativeEvent.layout.y);
                setCanvasTop(event.nativeEvent.layout.y);
              }}
            >
              {/* Until the wall is measured, its toolbar shows without the wallpaper. */}
              {width === 0 && !editing && toolbar}
              {width > 0 && (
                <WallGallery
                  pieces={pieces}
                  wallpaper={wallpaper}
                  width={width}
                  minHeight={Math.max(280, room.viewport + (editing ? 0 : room.pinned) - canvasTop)}
                  bottomInset={editing && !wallpaperPreview ? paletteHeight + insets.bottom : 0}
                  backgroundBottomInset={insets.bottom}
                  editing={editing && !wallpaperPreview}
                  locked={blocked}
                  scrollGesture={scrollGesture}
                  header={!editing && toolbar}
                  selectedId={selectedId}
                  onDeselect={() => setSelectedId(undefined)}
                  onArrange={arrange}
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
                          {editing ? "Tap Add to hang your first artwork." : "Choose from your saved artworks."}
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
          {/* Bottom overscroll continues the wall; above the header, the paper root shows. */}
          {canvas && <View pointerEvents="none" style={[styles.bottomOverscroll, { backgroundColor: color }]} />}
        </Animated.ScrollView>
      </GestureDetector>
      {canvas && !editing && <WallTopEdge edge={edge} height={insets.top} />}
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
            style={[styles.palette, { right: insets.right + 16, bottom: Math.max(insets.bottom, 12) }]}
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
          onRetry={onCollectionRetry}
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
          onChange={(layout) => arrange(arrangeWall(pieces, { [selected.localId]: layout }, width))}
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
  bottomOverscroll: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "100%",
    height: 1000,
  },
  toolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    minHeight: 52,
  },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  error: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Gallery.fill,
  },
  blank: { paddingHorizontal: Spacing.content, paddingTop: Spacing.two },
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
  palette: { position: "absolute" },
  tray: {
    backgroundColor: Gallery.paper,
    ...PinnedFooterBorder,
  },
  trayHeading: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
});
