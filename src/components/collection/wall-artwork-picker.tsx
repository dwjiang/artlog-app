import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, KeyboardAvoidingView, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { ChoiceMenu } from "@/components/choice-menu";
import { LoadingRing } from "@/components/loading-ring";
import { Modal } from "@/components/modal";
import { MotionPressable } from "@/components/motion-pressable";
import { PopOnTurnOn } from "@/components/pop-on-turn-on";
import { SearchField } from "@/components/search-field";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, PinnedFooterBorder, Radius, Spacing } from "@/constants/theme";
import type { SavedWork } from "@/db/schema";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cropSyncing } from "@/lib/account/photo-sync";
import { formatVisitDate } from "@/lib/journal/history";
import { gridColumns } from "@/lib/ui/grid-columns";
import { playToggleHaptic } from "@/lib/ui/haptics";
import { useHorizontalSafeAreaPadding, useSafeAreaWidth } from "@/lib/ui/safe-area";
import { canHangArtwork, libraryArtworks, type ArtworkSort, type LibraryVisit } from "@/lib/wall/artwork-library";
import type { WallPiece } from "@/lib/wall/wall-layout";
import { LIMITS } from "@/shared/journal/limits";

import { GalleryButton } from "./gallery-button";
import { SavedWorkImage } from "./saved-work-image";

type WallArtworkPickerProps = {
  works: SavedWork[];
  visits?: LibraryVisit[];
  pieces: WallPiece[];
  selectedIds: string[];
  count: number;
  signedIn: boolean;
  disabled: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  onChange: (ids: string[]) => void;
  onDismiss: () => void;
  onAdd: () => void;
};

export function WallArtworkPicker(props: WallArtworkPickerProps) {
  const reduced = useReducedMotion();
  return (
    <Modal animationType={reduced ? "fade" : "slide"} presentationStyle="fullScreen" onRequestClose={props.onDismiss}>
      <SafeAreaProvider>
        <PickerContent {...props} />
      </SafeAreaProvider>
    </Modal>
  );
}

function PickerContent({
  works,
  visits = [],
  pieces,
  selectedIds,
  count,
  signedIn,
  disabled,
  loading = false,
  error,
  onRetry,
  onChange,
  onDismiss,
  onAdd,
}: WallArtworkPickerProps) {
  const { fontScale } = useWindowDimensions();
  const width = useSafeAreaWidth();
  const insets = useSafeAreaInsets();
  const headerPadding = useHorizontalSafeAreaPadding(styles.header);
  const filtersPadding = useHorizontalSafeAreaPadding(styles.filters);
  const gridPadding = useHorizontalSafeAreaPadding(styles.grid);
  const footerPadding = useHorizontalSafeAreaPadding(styles.footer);
  const [search, setSearch] = useState("");
  const [visitId, setVisitId] = useState("");
  const [sort, setSort] = useState<ArtworkSort>("recent");
  const [notOnWall, setNotOnWall] = useState(true);
  const [review, setReview] = useState(false);
  const list = useRef<FlatList<SavedWork>>(null);
  const columns = gridColumns(2, width, fontScale);
  const cardWidth = (width - Spacing.content * 2 - (columns - 1) * Spacing.compact) / columns;
  const hungIds = useMemo(() => new Set(pieces.map((piece) => piece.saveLocalId ?? piece.localId)), [pieces]);
  const chosen = new Set(selectedIds);
  const selected = works.filter(
    (work) => chosen.has(work.localId) && !hungIds.has(work.localId) && canHangArtwork(work, signedIn),
  );
  const validIds = selected.map((work) => work.localId);
  useEffect(() => {
    if (selectedIds.some((id) => !validIds.includes(id))) onChange(validIds);
  });
  const visit = visits.find((item) => item.localId === visitId);
  // The collection is the complete owner-scoped SQLite snapshot. FlatList virtualizes images, not search results.
  const results = libraryArtworks(works, { search, sort, visit, notOnWall, hungIds });
  const data = review ? selected : results;
  useEffect(() => {
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [search, visitId, sort, notOnWall, review]);
  const visitOptions = [
    { value: "", label: "All Visits" },
    ...visits.map((item) => ({
      value: item.localId,
      label: `${item.venueName} · ${formatVisitDate(item.visitedOn)}`,
    })),
  ];
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={[styles.header, headerPadding]}>
        <GalleryButton
          label={review ? "Library" : "Wall"}
          icon="chevron.left"
          disabled={disabled}
          onPress={() => (review ? setReview(false) : onDismiss())}
        />
        <Text variant="section" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {review ? "Selected artworks" : "Add artworks"}
        </Text>
      </View>
      {!review && (
        <View style={[styles.filters, filtersPadding]}>
          <SearchField
            value={search}
            label="Search artworks"
            placeholder="Search title or artist"
            showLabel={false}
            filled
            onChange={setSearch}
            onClear={() => setSearch("")}
            editable={!disabled}
            maxLength={LIMITS.searchMax}
          />
          <View style={styles.filterRow}>
            <ChoiceMenu
              label="Show artworks"
              value={notOnWall ? "available" : "all"}
              options={[
                { value: "available", label: "Not on Wall" },
                { value: "all", label: "All Artworks" },
              ]}
              onChange={(value) => setNotOnWall(value === "available")}
              disabled={disabled}
            />
            <View style={{ flexShrink: 1 }}>
              <ChoiceMenu
                label="Visit"
                value={visit?.localId ?? ""}
                options={visitOptions}
                onChange={setVisitId}
                disabled={disabled}
              />
            </View>
          </View>
        </View>
      )}
      <FlatList
        ref={list}
        key={columns}
        data={data}
        numColumns={columns}
        keyExtractor={(item) => item.localId}
        style={{ flex: 1 }}
        bounces={data.length > 0}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={5}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.grid, gridPadding]}
        columnWrapperStyle={columns > 1 ? { gap: Spacing.compact } : undefined}
        ListHeaderComponent={
          <View style={styles.resultsHeading}>
            <Text variant="metadata" themeColor="textSecondary">
              {data.length} {data.length === 1 ? "artwork" : "artworks"}
              {review ? " selected" : ""}
            </Text>
            {!review && (
              <ChoiceMenu
                label="Sort by"
                value={sort}
                onChange={setSort}
                disabled={disabled}
                options={[
                  { value: "recent", label: "Recently Saved" },
                  { value: "title", label: "Title" },
                  { value: "artist", label: "Artist" },
                ]}
              />
            )}
          </View>
        }
        renderItem={({ item }) => {
          const hung = hungIds.has(item.localId);
          const checked = hung || chosen.has(item.localId);
          const syncing = !canHangArtwork(item, signedIn);
          const unavailable = hung || syncing || disabled || (!checked && count + selected.length >= LIMITS.wallItems);
          return (
            <MotionPressable
              accessibilityRole="checkbox"
              accessibilityLabel={item.title}
              accessibilityHint={hung ? "Already on your wall" : syncing ? "Available after syncing" : item.artist}
              accessibilityState={{ checked, disabled: unavailable }}
              disabled={unavailable}
              onPress={() => {
                playToggleHaptic(!checked);
                onChange(checked ? selectedIds.filter((id) => id !== item.localId) : [...selectedIds, item.localId]);
              }}
              style={[styles.card, { width: cardWidth }]}
            >
              <View style={[styles.mat, checked && styles.checked]}>
                <SavedWorkImage
                  path={item.cropPath}
                  syncing={cropSyncing(item)}
                  title={item.title}
                  contain
                  style={styles.image}
                />
                <PopOnTurnOn on={checked} dipOnTurnOff style={[styles.check, checked && styles.checkSelected]}>
                  {checked && (
                    <Image source="sf:checkmark" style={{ width: 12, height: 12 }} tintColor={Gallery.paper} />
                  )}
                </PopOnTurnOn>
              </View>
              <Text variant="secondary" numberOfLines={2} style={{ fontWeight: "600" }}>
                {item.title}
              </Text>
              <Text variant="metadata" themeColor="textSecondary" numberOfLines={2}>
                {item.artist || "Artist unknown"}
              </Text>
              {(hung || syncing) && (
                <Text variant="metadata" themeColor="textSecondary">
                  {hung ? "On your wall" : "Syncing artwork…"}
                </Text>
              )}
            </MotionPressable>
          );
        }}
        ListEmptyComponent={
          !loading && !error ? (
            <View style={styles.empty}>
              <Text variant="section">
                {review ? "No artworks selected" : works.length > 0 ? "No matching artworks" : "No saved artworks yet"}
              </Text>
              <Text themeColor="textSecondary" style={{ textAlign: "center" }}>
                {review
                  ? "Go back to the library to choose artworks."
                  : works.length > 0
                    ? "Try another search or change your filters."
                    : "Save an artwork to add it to your wall."}
              </Text>
              {!review && works.length > 0 && (
                <GalleryButton
                  label="Reset filters"
                  onPress={() => {
                    setSearch("");
                    setVisitId("");
                    setNotOnWall(false);
                  }}
                />
              )}
            </View>
          ) : undefined
        }
        ListFooterComponent={
          <>
            {loading && <LoadingRing accessibilityLabel="Loading artworks" />}
            {error && (
              <View>
                <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
                  {error}
                </Text>
                {onRetry && <GalleryButton label="Try again" disabled={disabled} onPress={onRetry} />}
              </View>
            )}
          </>
        }
      />
      <View style={[styles.footer, footerPadding, { paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
        <View style={styles.selectionRow}>
          <Text variant="secondary" style={{ fontWeight: "600" }}>
            {selected.length > 0 ? `${selected.length} selected` : "Select artworks"}
          </Text>
          <View style={styles.selectionActions}>
            {!review && selected.length > 0 && (
              <GalleryButton
                label="Review"
                accessibilityLabel="Review selected artworks"
                size="compact"
                disabled={disabled}
                onPress={() => {
                  Keyboard.dismiss();
                  setReview(true);
                }}
              />
            )}
            {selected.length > 0 && (
              <GalleryButton
                label="Clear"
                accessibilityLabel="Clear selection"
                tone="ink"
                size="compact"
                disabled={disabled}
                onPress={() => onChange([])}
              />
            )}
          </View>
        </View>
        {count + selected.length >= LIMITS.wallItems && (
          <Text variant="metadata" themeColor="textSecondary">
            Your wall holds up to {LIMITS.wallItems} artworks.
          </Text>
        )}
        {signedIn && selected.length > 0 && (
          <Text variant="metadata" themeColor="textSecondary">
            Selected photos will appear on your public wall.
          </Text>
        )}
        <GalleryButton
          label={
            selected.length > 0
              ? `Add ${selected.length} ${selected.length === 1 ? "artwork" : "artworks"} to wall`
              : "Add artworks to wall"
          }
          fullWidth
          variant="filled"
          disabled={selected.length === 0 || disabled}
          busy={disabled && selected.length > 0}
          busyLabel="Adding artworks"
          onPress={() => {
            Keyboard.dismiss();
            onAdd();
          }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Gallery.paper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.content,
    paddingHorizontal: Spacing.content,
    minHeight: 56,
  },
  filters: { paddingHorizontal: Spacing.content, gap: Spacing.two, paddingTop: Spacing.two },
  filterRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two, flexWrap: "wrap" },
  grid: { paddingHorizontal: Spacing.content, paddingBottom: Spacing.content },
  resultsHeading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  card: { gap: Spacing.one, marginBottom: Spacing.content },
  mat: {
    aspectRatio: 1,
    padding: Spacing.two,
    backgroundColor: Gallery.paper,
    borderRadius: Radius.input,
    borderWidth: 2,
    borderColor: "transparent",
    marginBottom: Spacing.two,
  },
  checked: { borderColor: Gallery.accent, backgroundColor: Gallery.highlight },
  image: { width: "100%", height: "100%" },
  check: {
    position: "absolute",
    top: Spacing.two,
    right: Spacing.two,
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Gallery.controlBorder,
    backgroundColor: Gallery.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  checkSelected: { backgroundColor: Gallery.accent, borderColor: Gallery.accent },
  empty: { paddingVertical: Spacing.five, gap: Spacing.two, alignItems: "center" },
  footer: {
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.two,
    gap: Spacing.two,
    ...PinnedFooterBorder,
  },
  selectionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  selectionActions: { flexDirection: "row", gap: Spacing.content },
});
