import { StyleSheet, View } from "react-native";

import { ImageSkeleton } from "@/components/loading-skeleton";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Fonts, Gallery, Radius, Spacing } from "@/constants/theme";
import { useMuseumImage } from "@/lib/explore/museum-image";
import { museumLine, museumSummary } from "@/lib/explore/museum-summary";
import type { ExploreData, ExploreMuseum } from "@/lib/explore/types";
import { photoCredit } from "@/lib/venue/use-museum-photo";

import { ExploreImage } from "./explore-image";
import { openMuseum } from "./explore-routes";

/**
 * The museum's photo, else a Look Around still, else its most pressing show's artwork, else a placeholder. Card-sized
 * Commons photos carry their credit. A still carries Apple's logo, and a show's artwork comes from the museum's own site,
 * which the card already names.
 */
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
  const card = width > 80;
  const style = { width, height, borderRadius: card ? Radius.card : 8 };
  const { image, loading } = useMuseumImage(data, museum, card ? "card" : "row");
  if (loading) {
    return (
      <View style={[styles.clip, style]}>
        <ImageSkeleton label={`Loading photo of ${museum.name}`} style={StyleSheet.absoluteFill} />
      </View>
    );
  }
  const credit = card && image?.source.kind === "commons" ? photoCredit(image.source.photo) : "";
  return <ExploreImage image={image} icon="building.columns" credit={credit} style={style} />;
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
  clip: { overflow: "hidden" },
  tile: { width: MUSEUM_TILE_WIDTH, gap: Spacing.two },
  text: { gap: 1, paddingTop: 2 },
  name: { fontFamily: Fonts.display, fontSize: 17, lineHeight: 22, letterSpacing: -0.2, color: Gallery.ink },
  line: { fontSize: 14, lineHeight: 20, color: Gallery.muted },
  ending: { color: Gallery.warning, fontWeight: "600" },
});
