import { StyleSheet, View } from "react-native";

import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Fonts, Gallery, Radius, Spacing } from "@/constants/theme";
import { museumCover, museumLine, museumSummary } from "@/lib/explore/museum-summary";
import type { ExploreData, ExploreMuseum } from "@/lib/explore/types";

import { ExploreImage } from "./explore-image";
import { openMuseum } from "./explore-routes";

/** The artwork of the museum's most pressing show, or a neutral placeholder. */
export function MuseumPhoto({
  data,
  museum,
  width,
  height,
}: {
  data: ExploreData;
  museum: ExploreMuseum;
  width: number;
  height: number;
}) {
  const radius = width > 80 ? Radius.card : 8;
  return (
    <ExploreImage
      image={museumCover(data, museum)}
      icon="building.columns"
      style={{ width, height, borderRadius: radius }}
    />
  );
}

const MUSEUM_TILE_WIDTH = 264;

export function MuseumTile({ data, museum }: { data: ExploreData; museum: ExploreMuseum }) {
  const summary = museumSummary(data, museum);
  const line = museumLine(museum);
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={[museum.name, line, summary.count, summary.ending].filter(Boolean).join(", ")}
      onPress={() => openMuseum(museum.id)}
      style={styles.tile}
    >
      <MuseumPhoto data={data} museum={museum} width={MUSEUM_TILE_WIDTH} height={160} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {museum.name}
        </Text>
        {line !== "" && (
          <Text style={styles.line} numberOfLines={1}>
            {line}
          </Text>
        )}
        <MuseumSummaryLine data={data} museum={museum} />
      </View>
    </MotionPressable>
  );
}

export function MuseumSummaryLine({ data, museum }: { data: ExploreData; museum: ExploreMuseum }) {
  const summary = museumSummary(data, museum);
  if (!summary.count) return null;
  return (
    <Text style={styles.line} numberOfLines={1}>
      {summary.count}
      {summary.ending && <Text style={styles.ending}>{` · ${summary.ending}`}</Text>}
    </Text>
  );
}

const styles = StyleSheet.create({
  tile: { width: MUSEUM_TILE_WIDTH, gap: Spacing.two },
  text: { gap: 1, paddingTop: 2 },
  name: { fontFamily: Fonts.display, fontSize: 17, lineHeight: 22, letterSpacing: -0.2, color: Gallery.ink },
  line: { fontSize: 14, lineHeight: 20, color: Gallery.muted },
  ending: { color: Gallery.warning, fontWeight: "600" },
});
