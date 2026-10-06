import { Image } from "expo-image";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import type { ExhibitionStatus } from "@/lib/explore/exhibition-timing";

const TONES = {
  warning: { icon: "sf:hourglass", color: Gallery.warning },
  accent: { icon: "sf:calendar", color: Gallery.accent },
  muted: { icon: "sf:calendar", color: Gallery.muted },
} as const;

/** The status in its tone; `detail`, such as the museum, follows in muted text. */
export function ExhibitionStatusLine({ status, detail }: { status: ExhibitionStatus; detail?: string }) {
  const { fontScale } = useWindowDimensions();
  const { icon, color } = TONES[status.tone];
  return (
    <View style={styles.row}>
      <Image
        source={icon}
        tintColor={color}
        accessible={false}
        style={{ width: 13 * fontScale, height: 13 * fontScale }}
      />
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {status.label}
        {detail && <Text style={styles.detail}>{` · ${detail}`}</Text>}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "600", flexShrink: 1 },
  detail: { fontWeight: "400", color: Gallery.muted },
});
