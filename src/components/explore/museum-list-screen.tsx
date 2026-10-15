import { FlatList, StyleSheet, View } from "react-native";

import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Fonts, Gallery, Spacing } from "@/constants/theme";
import { nearbyMuseums } from "@/lib/explore/lists";
import { museumLine, museumSummary } from "@/lib/explore/museum-summary";
import type { ExploreCatalog, ExploreMuseum } from "@/lib/explore/types";
import { useExplore } from "@/lib/explore/use-explore";

import { openMuseum } from "./explore-routes";
import { ExploreState } from "./explore-state";
import { listStyles } from "./list-styles";
import { MuseumPhoto, MuseumSummaryLine } from "./museum-tile";
import { WantToSeeMuseumButton } from "./want-to-see-button";

export function MuseumListScreen() {
  const explore = useExplore();
  const { data } = explore;
  if (!data) return <ExploreState view={explore} />;
  const museums = nearbyMuseums(data);
  return (
    <FlatList
      style={listStyles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={listStyles.content}
      data={museums}
      keyExtractor={(museum) => museum.id}
      renderItem={({ item, index }) => <MuseumRow data={data} museum={item} separator={index < museums.length - 1} />}
    />
  );
}

export function MuseumRow({
  data,
  museum,
  separator,
  selected = false,
}: {
  data: ExploreCatalog;
  museum: ExploreMuseum;
  separator: boolean;
  selected?: boolean;
}) {
  const summary = museumSummary(data, museum);
  const line = museumLine(museum);
  return (
    <View style={[styles.row, selected && styles.selected]}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={[museum.name, line, summary.count, summary.ending].filter(Boolean).join(", ")}
        onPress={() => openMuseum(museum.id)}
        style={styles.content}
      >
        <MuseumPhoto data={data} museum={museum} width={64} height={64} />
        <View style={[styles.text, separator && styles.separator]}>
          <Text style={styles.name} numberOfLines={2}>
            {museum.name}
          </Text>
          {line !== "" && <Text style={styles.line}>{line}</Text>}
          <MuseumSummaryLine data={data} museum={museum} />
        </View>
      </MotionPressable>
      <View style={[styles.accessory, separator && styles.separator]}>
        <WantToSeeMuseumButton museum={museum} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch", paddingLeft: Spacing.content, paddingRight: Spacing.two },
  content: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.compact },
  text: { flex: 1, alignSelf: "stretch", justifyContent: "center", gap: 2, paddingVertical: Spacing.compact },
  accessory: { justifyContent: "center" },
  selected: { backgroundColor: Gallery.highlight },
  separator: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  name: { fontFamily: Fonts.display, fontSize: 17, lineHeight: 22, letterSpacing: -0.2, color: Gallery.ink },
  line: { fontSize: 14, lineHeight: 20, color: Gallery.muted },
});
