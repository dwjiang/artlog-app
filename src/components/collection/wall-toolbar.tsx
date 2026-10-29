import { Image } from "expo-image";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GlassSurface } from "@/components/glass-surface";
import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { CompactBarMaxTextScale, Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import type { SavedWork } from "@/db/schema";
import { captureFileUri } from "@/lib/files/photos";

const PREVIEW_COUNT = 3;
const SPINNER_SIZE = 20;

/** Edit Wall and All Artworks on the wall's top edge; All Artworks previews the newest saves (`works` newest first). */
export function WallToolbar({
  works,
  onEdit,
  onAllArtworks,
  disabled,
  refreshing,
}: {
  works: SavedWork[];
  /** Leaving this out hides Edit Wall, for a wall that has not loaded. */
  onEdit?: () => void;
  onAllArtworks: () => void;
  disabled: boolean;
  refreshing: boolean;
}) {
  const count = works.length;
  const previews = works
    .flatMap(({ localId, cropPath }) => (cropPath ? [{ localId, cropPath }] : []))
    .slice(0, PREVIEW_COUNT);
  return (
    <View style={styles.row}>
      {onEdit && (
        <GlassButton label="Edit Wall" disabled={disabled} onPress={onEdit}>
          <Image source="sf:slider.horizontal.3" style={styles.icon} tintColor={Gallery.accent} accessible={false} />
          <Text maxFontSizeMultiplier={CompactBarMaxTextScale} style={styles.label}>
            Edit Wall
          </Text>
        </GlassButton>
      )}
      <View style={styles.trailing}>
        {/* Reserved while idle, so the ring appears without moving All Artworks or wrapping the row. */}
        <View style={styles.spinner}>
          {refreshing && <LoadingRing size={SPINNER_SIZE} accessibilityLabel="Refreshing wall" />}
        </View>
        <GlassButton
          label={`All Artworks, ${count} ${count === 1 ? "artwork" : "artworks"}`}
          disabled={disabled}
          onPress={onAllArtworks}
        >
          {previews.length > 0 && (
            <View style={styles.previews}>
              {previews.map(({ localId, cropPath }, index) => (
                <Image
                  key={localId}
                  source={captureFileUri(cropPath)}
                  cachePolicy="memory"
                  contentFit="cover"
                  accessible={false}
                  style={[styles.preview, index > 0 && styles.overlap]}
                />
              ))}
            </View>
          )}
          {/* Like a toolbar's, the labels stop growing at accessibility sizes, so no word breaks across lines. */}
          <Text maxFontSizeMultiplier={CompactBarMaxTextScale} style={styles.label}>
            All Artworks
          </Text>
          <Text maxFontSizeMultiplier={CompactBarMaxTextScale} style={styles.count}>
            {count}
          </Text>
          <Image source="sf:chevron.right" style={styles.chevron} tintColor={Gallery.accent} accessible={false} />
        </GlassButton>
      </View>
    </View>
  );
}

function GlassButton({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <GlassSurface tone="light" isInteractive style={styles.glass}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}
      >
        {children}
      </Pressable>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.compact,
    paddingBottom: Spacing.one,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    marginLeft: "auto",
    maxWidth: "100%",
  },
  spinner: { width: SPINNER_SIZE, height: SPINNER_SIZE, flexShrink: 0 },
  glass: { borderRadius: Radius.button, overflow: "hidden", maxWidth: "100%", flexShrink: 1 },
  button: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.compact,
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
  icon: { width: 18, height: 18 },
  label: { ...Typography.secondary, fontWeight: "600", color: Gallery.accent, flexShrink: 1 },
  // Muted text falls below 4.5:1 on glass over a dark wall.
  count: { ...Typography.secondary, color: Gallery.ink, marginLeft: -Spacing.one },
  chevron: { width: 11, height: 11, marginLeft: -Spacing.one },
  previews: { flexDirection: "row" },
  preview: {
    width: 24,
    height: 24,
    borderRadius: Radius.thumbnail,
    borderWidth: 1.5,
    borderColor: Gallery.surface,
    backgroundColor: Gallery.fill,
  },
  overlap: { marginLeft: -9 },
});
