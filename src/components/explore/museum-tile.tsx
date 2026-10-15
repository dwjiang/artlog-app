import { StyleSheet, View } from "react-native";

import { ImageSkeleton } from "@/components/loading-skeleton";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { useMuseumImage } from "@/lib/explore/museum-image";
import { museumLine, museumSummary } from "@/lib/explore/museum-summary";
import type { ExploreCatalog, ExploreMuseum } from "@/lib/explore/types";
import { photoCredit } from "@/lib/venue/use-museum-photo";

import { CardBookmark, cardText } from "./card-bookmark";
import { ExploreImage } from "./explore-image";
import { openMuseum } from "./explore-routes";
import { WantToSeeMuseumButton } from "./want-to-see-button";

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
  data: ExploreCatalog;
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
const MUSEUM_PHOTO_HEIGHT = 160;

export function MuseumTile({ data, museum }: { data: ExploreCatalog; museum: ExploreMuseum }) {
  const summary = museumSummary(data, museum);
  const line = museumLine(museum);
  return (
    <View style={styles.tile}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={[museum.name, line, summary.count, summary.ending].filter(Boolean).join(", ")}
        onPress={() => openMuseum(museum.id)}
        style={styles.content}
      >
        <MuseumPhoto data={data} museum={museum} width={MUSEUM_TILE_WIDTH} height={MUSEUM_PHOTO_HEIGHT} />
        <View style={[cardText.text, styles.text]}>
          <Text style={cardText.title} numberOfLines={1}>
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
      <CardBookmark imageHeight={MUSEUM_PHOTO_HEIGHT}>
        <WantToSeeMuseumButton museum={museum} />
      </CardBookmark>
    </View>
  );
}

export function MuseumSummaryLine({ data, museum }: { data: ExploreCatalog; museum: ExploreMuseum }) {
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
  tile: { width: MUSEUM_TILE_WIDTH },
  content: { gap: Spacing.two },
  text: { gap: 1 },
  line: { fontSize: 14, lineHeight: 20, color: Gallery.muted },
  ending: { color: Gallery.warning, fontWeight: "600" },
});
