import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet } from "react-native";

import { GlassSurface } from "@/components/glass-surface";
import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { useQueue } from "@/lib/queue/use-queue";

export function queueBadgeLabel(total: number): string {
  return `Recent scans, ${total} ${total === 1 ? "scan" : "scans"}`;
}

/** Includes viewed results until they are saved or discarded. */
export function QueueBadge() {
  const router = useRouter();
  const { items } = useQueue();
  if (items.length === 0) return null;
  return (
    <GlassSurface isInteractive style={styles.badge}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={queueBadgeLabel(items.length)}
        onPress={() => router.push("/queue")}
        style={({ pressed }) => [styles.content, pressed && styles.pressed]}
      >
        <Image
          source="sf:clock.arrow.circlepath"
          style={styles.icon}
          tintColor={Colors.light.overlayText}
        />
        <ThemedText type="smallBold" themeColor="overlayText">
          Recent {items.length}
        </ThemedText>
      </Pressable>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: Spacing.four, overflow: "hidden" },
  content: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
  },
  pressed: { opacity: 0.7 },
  icon: { width: 18, height: 18 },
});
