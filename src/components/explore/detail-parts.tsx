import { Image } from "expo-image";
import { Linking, StyleSheet, View, useWindowDimensions } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import type { ExhibitionStatus } from "@/lib/explore/exhibition-timing";
import type { ExploreMuseum } from "@/lib/explore/types";
import { reportError } from "@/lib/observability";

export function openDirections(museum: ExploreMuseum) {
  const url = `https://maps.apple.com/?daddr=${museum.lat},${museum.lng}&q=${encodeURIComponent(museum.name)}`;
  Linking.openURL(url).catch((error: unknown) => reportError(error, "explore.directions", { level: "warning" }));
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

/** One fact about a visit, such as the dates or today's hours, behind its symbol. */
export function FactRow({ icon, children, last = false }: { icon: string; children: string; last?: boolean }) {
  const { fontScale } = useWindowDimensions();
  return (
    <View style={[styles.fact, !last && styles.separator]}>
      <Image
        source={`sf:${icon}`}
        tintColor={Gallery.muted}
        accessible={false}
        style={{ width: 20 * fontScale, height: 20 * fontScale }}
      />
      <Text style={styles.factText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
});
