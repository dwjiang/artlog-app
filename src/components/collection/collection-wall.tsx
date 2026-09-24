import { reportError } from "@/lib/observability";
import { LoadingSkeleton, Ghost } from "../loading-skeleton";
import { WallSheet } from "./wall-sheet";
import { EmptyState } from "../empty-state";
import { ArtworkCollage } from "../guest/artwork-preview";
import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { DEFAULT_WALL_COLOR, DEFAULT_THUMBNAIL_FRAME } from "@/shared/wall/defaults";
import { randomUUID } from "expo-crypto";
import { selectArtworkPhotos } from "@/db/repos/artwork-album";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gallery, Radius } from "@/constants/theme";
import { useHideTabBar } from "@/components/tab-bar-visibility";
import type { SavedWork } from "@/db/schema";
import { useCollectionWall } from "@/lib/wall/use-collection-wall";
import {
  constrainLayout,
  isLightWall,
  nextWallLayout,
  removeWallPiece,
  type WallDraft,
  type WallLayout,
  type WallPiece,
} from "@/lib/wall/wall-layout";
import { captureOwner } from "@/lib/account/owner-store";
import { LIMITS } from "@/shared/journal/limits";
import { convexErrorCode } from "@/lib/network-error";
import { showToast } from "@/lib/ui/toast";
import { GalleryButton } from "./gallery-button";
import { signInRoute } from "@/lib/account/sign-in-context";
import { WallArtworkSheet } from "./wall-sheets";
import { WallProfileSheet } from "./wall-profile-sheet";
import { WallGallery } from "./wall-gallery";
import { SavedWorkImage } from "./saved-work-image";
import { cropSyncing } from "@/lib/account/photo-sync";
import { WallFrame, wallFrameInset } from "./wall-frame";
import { WallPhotoSheet } from "./wall-photo-sheet";

type CollectionWallProps = {
  works: SavedWork[];
  hiddenIds?: string[];
  onEditingChange?: (editing: boolean) => void;
  header?: ReactElement;
  controls?: ReactElement;
};
export function CollectionWall({ works, hiddenIds, onEditingChange, header, controls }: CollectionWallProps) {
  const wall = useCollectionWall(works);
  return (
    <CollectionWallContent
      works={works}
      hiddenIds={hiddenIds}
      onEditingChange={onEditingChange}
      wall={wall}
      header={header}
      controls={controls}
    />
  );
}

export function CollectionWallContent({
  works,
  hiddenIds = [],
  onEditingChange,
  wall,
  header,
  controls,
}: CollectionWallProps & { wall: ReturnType<typeof useCollectionWall> }) {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false),
    [width, setWidth] = useState(0);
  useHideTabBar(editing);
  const [viewportHeight, setViewportHeight] = useState(0),
    [canvasTop, setCanvasTop] = useState(0);
  const [profile, setProfile] = useState(false),
    [options, setOptions] = useState(false);
  const [picker, setPicker] = useState<string[]>();
  const [selectedId, setSelectedId] = useState<string>();
  // The photo sheet waits for the artwork sheet to finish dismissing: iOS drops a sheet presented while another animates out.
  const [photoPicker, setPhotoPicker] = useState<{
    kind: "choose" | "duplicate";
    presented: boolean;
  }>();
  const scroll = useRef<ScrollView>(null),
    wallTop = useRef(0),
    controlsHeight = useRef(0);
  const revealId = useRef<string | undefined>(undefined);
  const pieces = wall.pieces.filter((piece) => !hiddenIds.includes(piece.saveLocalId ?? piece.localId));
  const selected = pieces.find((piece) => piece.localId === selectedId);
  const color = wall.draft?.color ?? DEFAULT_WALL_COLOR;
  const count = wall.draft?.items.filter((item) => !hiddenIds.includes(item.saveLocalId)).length ?? 0;
  const opening = wall.loading && !wall.draft && !wall.error;
  const blank = !wall.draft?.items.length && !editing && !opening && !wall.error;
  const hasSavedArt = works.some((work) => !hiddenIds.includes(work.localId));
  const wallInk = isLightWall(color) ? Gallery.ink : Gallery.paper;
  const available = wall.selections.filter((item) => !hiddenIds.includes(item.localId));
  const failedSave = !!wall.layoutDraft && !!wall.error;
  const blocked = wall.pending || failedSave;
  useEffect(() => {
    const piece = pieces.find((item) => item.localId === revealId.current);
    if (!piece || !width) return;
    const frame = requestAnimationFrame(() => {
      scroll.current?.scrollTo({
        y: Math.max(0, wallTop.current + piece.layout.y * width - controlsHeight.current - 24),
        animated: false,
      });
      revealId.current = undefined;
    });
    return () => cancelAnimationFrame(frame);
  }, [pieces, width]);
  // Detail screens edit the wall through their own repository, so each return to this screen re-reads it. The memoized
  // callback reads through a ref so the first load (owned by the hook) and edits in progress are skipped without re-running.
  const focus = useRef({ loaded: false, editing: false });
  useEffect(() => {
    focus.current = { loaded: !!wall.acknowledged, editing };
  }, [wall.acknowledged, editing]);
  useFocusEffect(
    useCallback(() => {
      if (wall.signedIn && focus.current.loaded && !focus.current.editing) {
        void wall.refresh();
      }
      // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [wall.repository, wall.signedIn]),
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
      void wall.loadSelections(true);
    }
  }
  function discard() {
    wall.repository.discardDrafts();
    wall.setError(undefined);
    setSelectedId(undefined);
    setOptions(false);
    setPhotoPicker(undefined);
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
      setPhotoPicker(undefined);
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
    commit({
      ...wall.draft,
      items: wall.draft.items.map((item) =>
        item.placementId === id ? { ...item, layout: constrainLayout(item.layout, layout) } : item,
      ),
    });
  }
  function remove(id: string) {
    if (!wall.draft || blocked) return;
    commit(removeWallPiece(wall.draft, id));
    setSelectedId(undefined);
    setOptions(false);
  }
  function add(localId: string, chosenPhotoId?: string): boolean {
    if (!wall.draft || blocked || count >= LIMITS.wallItems) return false;
    const placementId = randomUUID();
    revealId.current = placementId;
    const photoLocalId =
      chosenPhotoId
      ?? selectArtworkPhotos(localId)
        .all()
        .find((photo) => photo.kind !== "label")?.localId;
    const layout = nextWallLayout(pieces);
    if (chosenPhotoId && selected?.saveLocalId === localId) {
      layout.frame = selected.layout.frame;
    }
    commit({
      ...wall.draft,
      items: [...wall.draft.items, { placementId, photoLocalId, saveLocalId: localId, layout }],
    });
    setSelectedId(placementId);
    return true;
  }

  function openPicker() {
    setPicker([]);
    void wall.loadSelections(true);
  }
  function addSelection() {
    if (!wall.draft || !picker?.length || blocked) return;
    const nextPieces: WallPiece[] = [...pieces];
    const items = [...wall.draft.items];
    for (const localId of picker) {
      const selection = available.find((item) => item.localId === localId);
      if (!selection || items.some((item) => item.saveLocalId === localId) || items.length >= LIMITS.wallItems) {
        continue;
      }
      const placementId = randomUUID(),
        layout = nextWallLayout(nextPieces);
      const photoLocalId = selectArtworkPhotos(localId)
        .all()
        .find((photo) => photo.kind !== "label")?.localId;
      items.push({ placementId, saveLocalId: localId, photoLocalId, layout });
      nextPieces.push({
        localId: placementId,
        saveLocalId: localId,
        layout,
        cropAspectRatio: selection.cropAspectRatio,
        artwork: {
          ...selection.snapshot,
          media: { kind: "placeholder", width: 1, height: 1 },
        },
      });
    }
    commit({ ...wall.draft, items });
    setPicker(undefined);
    changeEditing(true);
  }

  function finishEditing() {
    changeEditing(false);
    setSelectedId(undefined);
    setOptions(false);
  }

  return (
    <GestureHandlerRootView style={[styles.root, { backgroundColor: color }]}>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        scrollEnabled={!wall.pending}
        stickyHeaderIndices={[header && !editing ? 1 : 0]}
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        refreshControl={
          wall.signedIn && !editing ? (
            <RefreshControl
              refreshing={wall.loading}
              tintColor="transparent"
              onRefresh={() => {
                void wall.refresh();
              }}
            />
          ) : undefined
        }
      >
        {!editing && header}
        <View
          onLayout={(event) => {
            controlsHeight.current = event.nativeEvent.layout.height;
          }}
          style={{ backgroundColor: Gallery.paper }}
        >
          {!editing && controls}
          <View style={styles.toolbar}>
            {editing ? (
              <>
                <Text variant="section" accessibilityRole="header">
                  Edit wall
                </Text>
                {!wall.pending && (
                  <Text variant="metadata" themeColor="textSecondary">
                    {failedSave ? "Not saved" : "Changes saved"}
                  </Text>
                )}
              </>
            ) : (
              <>
                {!blank && (
                  <GalleryButton
                    label="Edit wall"
                    icon="slider.horizontal.3"
                    disabled={blocked || !wall.draft}
                    onPress={edit}
                  />
                )}
                <View style={styles.toolbarTrailing}>
                  {wall.loading && wall.draft && !wall.error && <LoadingRing accessibilityLabel="Refreshing wall" />}
                  <GalleryButton
                    label="All artworks"
                    icon="chevron.right"
                    iconPosition="trailing"
                    tone="ink"
                    disabled={blocked}
                    onPress={() => router.push("/all-artworks")}
                  />
                </View>
              </>
            )}
          </View>
        </View>
        {editing && <Text style={styles.publicNotice}>Hold and drag to move. Drag a corner to resize.</Text>}
        {editing && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, flexShrink: 0, minHeight: 52 }}
            contentContainerStyle={styles.swatches}
          >
            <Text style={styles.caption}>Wall color</Text>
            {Gallery.colors.map(({ name, value: swatchColor }) => (
              <Pressable
                key={swatchColor}
                accessibilityRole="button"
                accessibilityLabel={`${name} wall`}
                accessibilityState={{
                  selected: color === swatchColor,
                  disabled: blocked,
                }}
                disabled={blocked}
                onPress={() => {
                  if (wall.draft) commit({ ...wall.draft, color: swatchColor });
                }}
                style={{
                  width: 44,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    width: 23,
                    height: 23,
                    borderRadius: 12,
                    backgroundColor: swatchColor,
                    borderWidth: color === swatchColor ? 2 : 0.5,
                    borderColor: Gallery.ink,
                    outlineWidth: color === swatchColor ? 2 : 0,
                    outlineOffset: 3,
                    outlineColor: Gallery.paper,
                  }}
                />
              </Pressable>
            ))}
          </ScrollView>
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
          <LoadingSkeleton label="Opening your wall…" style={{ padding: 20 }}>
            <View style={{ gap: 16 }}>
              <Ghost height={376} />
              <Ghost width="62%" height={16} />
            </View>
          </LoadingSkeleton>
        ) : blank ? (
          <View
            style={[
              styles.blankWall,
              {
                backgroundColor: color === DEFAULT_WALL_COLOR ? "#EFEEE7" : color,
              },
            ]}
          >
            <EmptyState
              title="Add artworks to your wall."
              detail={`You have ${works.length} ${works.length === 1 ? "artwork" : "artworks"} saved. Pick the ones you’d like to hang on your public wall.`}
              footnote="Only the pieces you choose appear here."
              visual={<ArtworkCollage />}
            >
              <GalleryButton
                label={
                  !wall.signedIn
                    ? "Sign in"
                    : !wall.draft && !wall.profileRequired
                      ? "Load wall"
                      : hasSavedArt
                        ? "Choose artworks"
                        : "Scan artwork"
                }
                variant="filled"
                fullWidth
                onPress={() => {
                  if (!wall.signedIn) router.push(signInRoute("wall"));
                  else if (!wall.draft && !wall.profileRequired) void wall.refresh();
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
              setWidth(event.nativeEvent.layout.width);
              wallTop.current = event.nativeEvent.layout.y;
              setCanvasTop(event.nativeEvent.layout.y);
            }}
          >
            {width > 0 && (
              <WallGallery
                pieces={pieces}
                color={color}
                width={width}
                minHeight={Math.max(280, viewportHeight - canvasTop)}
                editing={editing && !blocked}
                selectedId={selectedId}
                onRemove={remove}
                onMove={move}
                onSelect={(piece) => {
                  if (editing) setSelectedId(piece.localId);
                  else if (works.some((work) => work.localId === piece.saveLocalId)) {
                    router.push({
                      pathname: "/saved/[savedId]",
                      params: {
                        savedId: piece.saveLocalId!,
                        photoId: piece.photoLocalId,
                      },
                    });
                  } else {
                    setSelectedId(piece.localId);
                    setOptions(true);
                  }
                }}
              >
                {!count && (
                  <View style={styles.empty}>
                    {!opening && (
                      <Text variant="display" style={[styles.emptyTitle, { color: wallInk }]}>
                        Add artworks to your wall.
                      </Text>
                    )}
                    {!opening && (
                      <Text style={[styles.emptyCaption, { color: wallInk }]}>
                        {editing ? "Tap a saved artwork below to hang it." : "Choose from your saved artworks."}
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
      </ScrollView>
      {editing && (
        <View style={[styles.tray, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingRight: 20,
            }}
          >
            <Text variant="metadata" style={styles.trayLabel}>
              Saved artworks
            </Text>
            <GalleryButton label="Choose artworks" disabled={blocked} onPress={openPicker} />
          </View>
          <ScrollView
            horizontal
            accessibilityLabel="Saved artworks"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.artworkStrip}
          >
            {available.map((item) => {
              const placement = pieces.find((piece) => piece.saveLocalId === item.localId);
              const isSelected = selected?.saveLocalId === item.localId;
              const frame = placement?.layout.frame ?? DEFAULT_THUMBNAIL_FRAME;
              const imageWidth = 88 - wallFrameInset(frame, 88) * 2;
              const disabled = blocked || (!placement && count >= LIMITS.wallItems);
              return (
                <Pressable
                  key={item.localId}
                  accessibilityRole="button"
                  accessibilityLabel={`${placement ? "Select" : "Hang"} ${item.snapshot.title}`}
                  accessibilityState={{ selected: isSelected, disabled }}
                  disabled={disabled}
                  onPress={() => {
                    if (placement) {
                      setSelectedId(placement.localId);
                      revealId.current = placement.localId;
                    } else if (add(item.localId)) {
                      showToast("Selected image added to your wall. Other photos stay private.");
                    }
                  }}
                  style={[
                    styles.artworkCard,
                    {
                      width: 140 * Math.min(fontScale, 1.5),
                      borderColor: isSelected ? Gallery.accent : Gallery.softBorder,
                      borderWidth: isSelected ? 2 : 1,
                    },
                  ]}
                >
                  <View style={styles.artworkMat}>
                    <WallFrame frame={frame} width={88}>
                      <SavedWorkImage
                        path={works.find((work) => work.localId === item.localId)?.cropPath ?? null}
                        syncing={works.some((work) => work.localId === item.localId && cropSyncing(work))}
                        title={item.snapshot.title}
                        contain
                        style={{ width: imageWidth, height: 60 }}
                      />
                    </WallFrame>
                  </View>
                  <Text numberOfLines={1} variant="metadata" style={{ fontWeight: "600" }}>
                    {item.snapshot.title}
                  </Text>
                  <Text numberOfLines={1} variant="metadata" themeColor="textSecondary">
                    {item.snapshot.artist}
                  </Text>
                </Pressable>
              );
            })}
            {wall.loadingSelections ? (
              <LoadingRing color={Gallery.accent} />
            ) : wall.cursor !== null ? (
              <GalleryButton
                label="More artworks"
                disabled={blocked}
                onPress={() => {
                  void wall.loadSelections();
                }}
              />
            ) : !available.length ? (
              <Text style={styles.caption}>Save an artwork to add it to your wall.</Text>
            ) : null}
          </ScrollView>
          <View style={styles.trayActions}>
            <View style={{ flex: 1 }}>
              <GalleryButton
                label="Frame & photo"
                icon="slider.horizontal.3"
                variant="outlined"
                fullWidth
                disabled={!selected || blocked}
                onPress={() => setOptions(true)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <GalleryButton
                label="Done"
                variant="filled"
                fullWidth
                busy={wall.pending}
                disabled={blocked}
                onPress={finishEditing}
              />
            </View>
          </View>
        </View>
      )}
      {picker && (
        <WallSheet title="Choose artworks" size="large" onDismiss={() => setPicker(undefined)}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
            <Text style={styles.caption}>{count + picker.length} selected · Your wall is public</Text>
            {available.map((item) => {
              const hung = pieces.some((piece) => piece.saveLocalId === item.localId);
              const checked = hung || picker.includes(item.localId);
              return (
                <Pressable
                  key={item.localId}
                  accessibilityRole="checkbox"
                  accessibilityLabel={item.snapshot.title}
                  accessibilityState={{ checked, disabled: hung }}
                  disabled={hung || blocked || (!checked && count + picker.length >= LIMITS.wallItems)}
                  onPress={() =>
                    setPicker((ids) =>
                      ids?.includes(item.localId)
                        ? ids.filter((id) => id !== item.localId)
                        : [...(ids ?? []), item.localId],
                    )
                  }
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 8,
                  }}
                >
                  <SavedWorkImage
                    path={works.find((work) => work.localId === item.localId)?.cropPath ?? null}
                    title={item.snapshot.title}
                    contain
                    style={{ width: 60, height: 60 }}
                  />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text>{item.snapshot.title}</Text>
                    <Text style={styles.caption}>
                      {item.snapshot.artist}
                      {hung ? " · On wall" : ""}
                    </Text>
                  </View>
                  <Text style={{ color: Gallery.accent }}>{checked ? "✓" : "○"}</Text>
                </Pressable>
              );
            })}
            {wall.loadingSelections ? (
              <LoadingRing accessibilityLabel="Loading artworks" />
            ) : wall.cursor !== null ? (
              <GalleryButton
                label="More artworks"
                onPress={() => {
                  void wall.loadSelections();
                }}
              />
            ) : !available.length ? (
              <Text style={styles.caption}>Your artworks appear here once they have synced.</Text>
            ) : null}
            {wall.error && (
              <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
                {wall.error}
              </Text>
            )}
          </ScrollView>
          <View
            style={{
              padding: 20,
              paddingBottom: Math.max(insets.bottom, 20),
              backgroundColor: Gallery.paper,
            }}
          >
            <GalleryButton
              label={`Add ${picker.length || ""} ${picker.length === 1 ? "artwork" : "artworks"} to wall`.replace(
                "  ",
                " ",
              )}
              fullWidth
              variant="filled"
              disabled={!picker.length || blocked}
              onPress={addSelection}
            />
          </View>
        </WallSheet>
      )}
      {photoPicker?.presented && selected?.saveLocalId && (
        <WallPhotoSheet
          savedId={selected.saveLocalId}
          title={selected.artwork.title}
          photoId={selected.photoLocalId}
          duplicate={photoPicker.kind === "duplicate"}
          onDismiss={() => setPhotoPicker(undefined)}
          onConfirm={(photoLocalId) => {
            if (photoPicker.kind === "duplicate") {
              if (add(selected.saveLocalId!, photoLocalId)) {
                showToast("Second placement added. Only this photo is public.");
              }
            } else if (wall.draft && !blocked) {
              commit({
                ...wall.draft,
                items: wall.draft.items.map((item) =>
                  item.placementId === selected.localId ? { ...item, photoLocalId } : item,
                ),
              });
              showToast("Wall photo updated. Other photos remain private.");
            }
            setPhotoPicker(undefined);
          }}
        />
      )}
      {options && selected && (
        <WallArtworkSheet
          piece={selected}
          editing={editing}
          disabled={blocked}
          color={color}
          presented={!photoPicker}
          onDismiss={() => setOptions(false)}
          onDismissed={() => {
            setOptions(false);
            setPhotoPicker((picker) => picker && { ...picker, presented: true });
          }}
          onChange={(layout) => move(selected.localId, layout)}
          onRemove={() => remove(selected.localId)}
          onChoosePhoto={selected.saveLocalId ? () => setPhotoPicker({ kind: "choose", presented: false }) : undefined}
          onDuplicatePhoto={
            selected.saveLocalId && count < LIMITS.wallItems
              ? () => setPhotoPicker({ kind: "duplicate", presented: false })
              : undefined
          }
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
  swatches: {
    alignItems: "center",
    paddingHorizontal: 20,
    gap: 1,
    paddingBottom: 8,
    backgroundColor: Gallery.paper,
  },
  error: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Gallery.fill,
  },
  blankWall: {
    flex: 1,
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
  publicNotice: {
    fontSize: 12,
    lineHeight: 18,
    color: Gallery.muted,
    backgroundColor: Gallery.paper,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
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
  trayLabel: { paddingHorizontal: 20, paddingTop: 12 },
  artworkStrip: {
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: "center",
  },
  artworkCard: {
    borderRadius: Radius.input,
    padding: 6,
    backgroundColor: Gallery.surface,
    gap: 2,
  },
  artworkMat: {
    height: 68,
    backgroundColor: Gallery.fill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 3,
  },
  trayActions: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
});
