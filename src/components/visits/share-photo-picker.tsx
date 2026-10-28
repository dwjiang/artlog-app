import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { useEffect } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { LoadingImage } from "@/components/loading-image";
import { PhotoStripSkeleton } from "@/components/loading-skeleton";
import { MotionPressable } from "@/components/motion-pressable";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { selectVisitArtworkPhotos } from "@/db/repos/artwork-album";
import type { SavedWork } from "@/db/schema";
import { captureFileUri } from "@/lib/files/photos";
import { reportError } from "@/lib/observability";
import { gridColumns } from "@/lib/ui/grid-columns";
import { playToggleHaptic } from "@/lib/ui/haptics";
import { useSafeAreaWidth } from "@/lib/ui/safe-area";

import { ShareTileImage } from "./share-artwork-tile";
import { VisitSymbol, visitStyles } from "./visit-ui";

const KIND_LABELS = { full: "full artwork", detail: "detail", label: "museum label" } as const;

function SelectAllButton({
  allSelected,
  disabled,
  onChange,
}: {
  allSelected: boolean;
  disabled?: boolean;
  onChange: (all: boolean) => void;
}) {
  return (
    <GalleryButton
      label={allSelected ? "Deselect all" : "Select all"}
      disabled={disabled}
      onPress={() => onChange(!allSelected)}
    />
  );
}

export function SharePhotoPicker({
  work,
  visitId,
  selected,
  onChange,
}: {
  work: SavedWork;
  visitId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { fontScale } = useWindowDimensions();
  const width = useSafeAreaWidth();
  const { data, updatedAt, error } = useLiveQuery(selectVisitArtworkPhotos(work.localId, visitId, work.owner), [
    work.localId,
    visitId,
    work.owner,
  ]);
  useEffect(() => {
    if (error) reportError(error, "visit.share-photos.load");
  }, [error]);
  const photos = data.filter((row) => row.owner === work.owner);
  const columns = gridColumns(2, width, fontScale);
  const size = (width - 2 * GUTTER - (columns - 1) * GAP) / columns;
  return (
    <SafeAreaScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: Gallery.paper }}
      contentContainerStyle={styles.content}
    >
      <View style={visitStyles.sectionLabel}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" variant="section">
            {work.title}
          </Text>
          <Text style={visitStyles.fine}>
            {`${selected.length} of ${photos.length} ${photos.length === 1 ? "photo" : "photos"} selected`}
          </Text>
        </View>
        {photos.length > 0 && (
          <SelectAllButton
            allSelected={photos.every((photo) => selected.includes(photo.localId))}
            onChange={(all) => onChange(all ? photos.map((photo) => photo.localId) : [])}
          />
        )}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
          Photos could not load. Go back and open this artwork again.
        </Text>
      ) : !updatedAt && data.length === 0 ? (
        <PhotoStripSkeleton />
      ) : null}
      <View style={styles.grid}>
        {photos.map((photo) => {
          const on = selected.includes(photo.localId);
          return (
            <MotionPressable
              key={photo.localId}
              accessibilityRole="checkbox"
              accessibilityLabel={`Share ${KIND_LABELS[photo.kind]} photo`}
              accessibilityState={{ checked: on }}
              onPress={() => {
                playToggleHaptic(!on);
                onChange(on ? selected.filter((id) => id !== photo.localId) : [...selected, photo.localId]);
              }}
            >
              <ShareTileImage
                size={size}
                selected={on}
                badge={<VisitSymbol name="checkmark" size={12} color={Gallery.ink} />}
              >
                {photo.path ? (
                  <LoadingImage
                    uri={captureFileUri(photo.path)}
                    label={`${KIND_LABELS[photo.kind]} photo`}
                    style={{ width: size, height: size }}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.unavailable, { width: size, height: size }]}>
                    <Text style={[visitStyles.fine, { textAlign: "center" }]}>Photo unavailable on this iPhone.</Text>
                  </View>
                )}
              </ShareTileImage>
            </MotionPressable>
          );
        })}
      </View>
    </SafeAreaScrollView>
  );
}

const GUTTER = 20;
const GAP = 12;
const styles = StyleSheet.create({
  content: { paddingHorizontal: GUTTER, paddingTop: 12, paddingBottom: 32, gap: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  unavailable: { alignItems: "center", justifyContent: "center", padding: 12, backgroundColor: Gallery.fill },
});
