import { Image } from "expo-image";
import { openBrowserAsync } from "expo-web-browser";
import { Linking, StyleSheet, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import { useToggleBounce } from "@/hooks/use-symbol-bounce";
import type { ExhibitionStatus } from "@/lib/explore/exhibition-timing";
import type { ExploreMuseum } from "@/lib/explore/types";
import { reportError } from "@/lib/observability";

export function openDirections(museum: ExploreMuseum) {
  const url = `https://maps.apple.com/?daddr=${museum.lat},${museum.lng}&q=${encodeURIComponent(museum.name)}`;
  Linking.openURL(url).catch((error: unknown) => reportError(error, "explore.directions", { level: "warning" }));
}

/** Opens a page credited for a show or a photo; `context` names it in error reports. */
export function openSourcePage(url: string, context: string) {
  openBrowserAsync(url).catch((error: unknown) => reportError(error, context, { level: "warning" }));
}

// The filled button's own height, so an outlined neighbor lines up with it.
const BUTTON_HEIGHT = 52;

/** A detail page's Want to see toggle beside directions to `museum`, side by side while both fit. */
export function DetailActions({
  saved,
  ready,
  onToggle,
  museum,
}: {
  saved: boolean;
  ready: boolean;
  onToggle: () => void;
  museum: ExploreMuseum | undefined;
}) {
  const bounce = useToggleBounce(ready ? saved : undefined);
  return (
    <View style={styles.actions}>
      <View style={styles.action}>
        <GalleryButton
          label={saved ? "Saved" : "Want to see"}
          accessibilityLabel={saved ? "Remove from Want to see" : "Want to see"}
          icon={saved ? "bookmark.fill" : "bookmark"}
          iconModifiers={bounce}
          variant={saved ? "outlined" : "filled"}
          fullWidth
          minHeight={BUTTON_HEIGHT}
          disabled={!ready}
          onPress={onToggle}
        />
      </View>
      <View style={styles.action}>
        {museum && (
          <GalleryButton
            label="Directions"
            icon="arrow.triangle.turn.up.right.diamond"
            variant="outlined"
            fullWidth
            minHeight={BUTTON_HEIGHT}
            onPress={() => openDirections(museum)}
          />
        )}
      </View>
    </View>
  );
}

const CHIPS = {
  warning: { icon: "sf:hourglass", color: Gallery.warning, background: "#F8EFDF" },
  accent: { icon: "sf:calendar", color: Gallery.accent, background: Gallery.highlight },
  muted: { icon: "sf:calendar", color: Gallery.ink, background: Gallery.fill },
} as const;

export function StatusChip({ status }: { status: ExhibitionStatus }) {
  const { fontScale } = useWindowDimensions();
  const chip = CHIPS[status.tone];
  return (
    <View style={[styles.chip, { backgroundColor: chip.background }]}>
      <Image
        source={chip.icon}
        tintColor={chip.color}
        accessible={false}
        style={{ width: 12 * fontScale, height: 12 * fontScale }}
      />
      <Text style={[styles.chipLabel, { color: chip.color }]}>{status.label}</Text>
    </View>
  );
}

/** One fact about a visit, such as the dates, behind its symbol. With `onPress` it is a link. */
export function FactRow({
  icon,
  children,
  last = false,
  onPress,
}: {
  icon: string;
  children: string;
  last?: boolean;
  onPress?: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  const style = [styles.fact, !last && styles.separator];
  const content = (
    <>
      <Image
        source={`sf:${icon}`}
        tintColor={Gallery.muted}
        accessible={false}
        style={{ width: 20 * fontScale, height: 20 * fontScale }}
      />
      <Text style={[styles.factText, onPress && styles.link]}>{children}</Text>
    </>
  );
  return onPress ? (
    <MotionPressable accessibilityRole="link" onPress={onPress} style={style}>
      {content}
    </MotionPressable>
  ) : (
    <View style={style}>{content}</View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.compact },
  action: { flexGrow: 1, flexBasis: 140 },
  chip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Radius.button,
  },
  chipLabel: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  fact: { flexDirection: "row", alignItems: "center", gap: Spacing.compact, paddingVertical: Spacing.compact },
  separator: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  factText: { ...Typography.body, color: Gallery.ink, flex: 1 },
  link: { color: Gallery.accent },
});
