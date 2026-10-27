import { Image } from "expo-image";
import { StyleSheet } from "react-native";

import { GlassSurface } from "@/components/glass-surface";
import { MotionPressable } from "@/components/motion-pressable";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import type { DemoPainting } from "@/lib/capture/demo-viewfinder";

const THUMBNAIL_MAX = 44;

/** The judges' demo build's stand-in for walking up to a painting: one tap points the camera at it. */
export function DemoPaintingStrip({
  paintings,
  selected,
  disabled,
  onSelect,
}: {
  paintings: DemoPainting[];
  selected: number | undefined;
  disabled: boolean;
  onSelect: (index: number) => void;
}) {
  return (
    <GlassSurface style={styles.strip}>
      {paintings.map((painting, index) => (
        <MotionPressable
          key={painting.thumbnail}
          accessibilityRole="button"
          accessibilityLabel={painting.title}
          accessibilityHint={`${painting.artist}. Points the camera at this painting.`}
          accessibilityState={{ selected: index === selected, disabled }}
          disabled={disabled}
          hitSlop={{ top: Spacing.one, bottom: Spacing.one }}
          onPress={() => onSelect(index)}
          style={[styles.item, index === selected && styles.selected, disabled && styles.disabled]}
        >
          <Image source={{ uri: painting.thumbnail }} cachePolicy="memory" style={styles.thumbnail} />
        </MotionPressable>
      ))}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.one,
    padding: Spacing.one,
    borderRadius: Radius.card,
    overflow: "hidden",
  },
  // The ring sits outside the thumbnail, so selecting one never shifts the others.
  item: {
    flex: 1,
    maxWidth: THUMBNAIL_MAX,
    aspectRatio: 1,
    padding: 2,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: Radius.thumbnail + 4,
  },
  selected: { borderColor: Gallery.paper },
  disabled: { opacity: 0.5 },
  thumbnail: { flex: 1, borderRadius: Radius.thumbnail },
});
