import { Image } from "expo-image";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";

/** Chips that wrap onto as many lines as they need. */
export function SearchChips({ children }: { children: ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}

/** A white chip on the grouped Search page, for a recent search or a popular tag. */
export function SearchChip({
  label,
  detail,
  leading,
  accessibilityLabel,
  onPress,
  onRemove,
}: {
  label: string;
  /** Muted text after the label, such as a post count. */
  detail?: string;
  leading?: ReactNode;
  accessibilityLabel: string;
  onPress: () => void;
  /** Adds a remove button after the label. */
  onRemove?: () => void;
}) {
  const content = (
    <>
      {leading}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {detail !== undefined && <Text style={styles.detail}>{detail}</Text>}
    </>
  );
  const open = {
    accessibilityRole: "button",
    accessibilityLabel,
    // Chips are 36 points tall; the slop reaches the 44-point target without spreading the rows apart.
    hitSlop: 4,
    onPress,
  } as const;
  if (!onRemove) {
    return (
      <MotionPressable {...open} style={[styles.chip, styles.padded, !!leading && styles.withLeading]}>
        {content}
      </MotionPressable>
    );
  }
  // Two sibling buttons rather than one inside the other, so VoiceOver reaches both.
  return (
    <View style={styles.chip}>
      <MotionPressable {...open} style={[styles.main, styles.padded, !!leading && styles.withLeading]}>
        {content}
      </MotionPressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${label} from recent searches`}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 8 }}
        style={({ pressed }) => [styles.remove, pressed && styles.removePressed]}
        onPress={onRemove}
      >
        <Image source="sf:xmark" tintColor={Gallery.muted} style={styles.removeIcon} accessible={false} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    maxWidth: "100%",
    borderRadius: Radius.full,
    backgroundColor: Gallery.surface,
  },
  main: { flexDirection: "row", alignItems: "center", flexShrink: 1, alignSelf: "stretch", paddingRight: 0 },
  padded: { gap: 6, paddingHorizontal: Spacing.three },
  withLeading: { paddingLeft: 6 },
  label: { ...Typography.secondary, fontWeight: "600", color: Gallery.ink, flexShrink: 1 },
  detail: { ...Typography.secondary, color: Gallery.muted, fontVariant: ["tabular-nums"] },
  remove: { alignSelf: "stretch", justifyContent: "center", paddingLeft: Spacing.two, paddingRight: Spacing.compact },
  removePressed: { opacity: 0.5 },
  removeIcon: { width: 11, height: 11 },
});
