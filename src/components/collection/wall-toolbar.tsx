import { Image } from "expo-image";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GlassSurface } from "@/components/glass-surface";
import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import type { SavedWork } from "@/db/schema";
import { captureFileUri } from "@/lib/files/photos";

const PREVIEW_COUNT = 3;

/** Edit wall and All artworks on the wall's top edge; All artworks previews the newest saves (`works` newest first). */
export function WallToolbar({
  works,
  onEdit,
  onAllArtworks,
  disabled,
  refreshing,
}: {
  works: SavedWork[];
  /** Leaving this out hides Edit wall, for a wall that has not loaded. */
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
        <GlassButton label="Edit wall" disabled={disabled} onPress={onEdit}>
          <Image source="sf:slider.horizontal.3" style={styles.icon} tintColor={Gallery.accent} accessible={false} />
          <Text style={styles.label}>Edit wall</Text>
        </GlassButton>
      )}
      <View style={styles.trailing}>
        {refreshing && <LoadingRing accessibilityLabel="Refreshing wall" />}
        <GlassButton
          label={`All artworks, ${count} ${count === 1 ? "artwork" : "artworks"}`}
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
          <Text style={styles.label}>All artworks</Text>
          <Text style={styles.count}>{count}</Text>
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
