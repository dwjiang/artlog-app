import type { FunctionReturnType } from "convex/server";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { DisplayMedia } from "@/components/artwork/display-media";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Fonts, Gallery, OnPhoto, Radius, Spacing, Typography } from "@/constants/theme";
import { useSafeAreaWidth } from "@/lib/ui/safe-area";

import type { api } from "../../../convex/_generated/api";
import { SearchChip, SearchChips } from "./search-chip";
import { postCount } from "./tag-row";

export type PopularTag = FunctionReturnType<typeof api.tags.popular>[number];

// Fewer tiles than two full rows read as a gap rather than a grid, so short lists stay chips.
const MIN_TILES = 4;
const TILE_HEIGHT = 104;
const GAP = 10;

/** Popular tags as artwork tiles, or as chips while there are too few to fill the grid. */
export function PopularTags({ tags, onOpen }: { tags: PopularTag[]; onOpen: (tag: string) => void }) {
  const { fontScale } = useWindowDimensions();
  const width = useSafeAreaWidth();
  if (tags.length < MIN_TILES) {
    return (
      <SearchChips>
        {tags.map((tag) => (
          <SearchChip
            key={tag.tag}
            label={`#${tag.tag}`}
            detail={String(tag.postCount)}
            accessibilityLabel={`#${tag.tag}, ${postCount(tag.postCount)}`}
            onPress={() => onOpen(tag.tag)}
          />
        ))}
      </SearchChips>
    );
  }
  // Large text gets the whole row, as artwork grids do above 1.4×.
  const columns = fontScale > 1.4 ? 1 : 2;
  const tileWidth = (width - Spacing.content * 2 - GAP * (columns - 1)) / columns;
  const tileHeight = Math.round(TILE_HEIGHT * Math.min(Math.max(fontScale, 1), 1.4));
  return (
    <View style={styles.tiles}>
      {tags.map((tag) => (
        <MotionPressable
          key={tag.tag}
          accessibilityRole="button"
          accessibilityLabel={`#${tag.tag}, ${postCount(tag.postCount)}`}
          style={[styles.tile, { width: tileWidth, height: tileHeight }]}
          onPress={() => onOpen(tag.tag)}
        >
          {tag.cover && (
            <View
              style={StyleSheet.absoluteFill}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <DisplayMedia media={tag.cover} label={`#${tag.tag}`} width={tileWidth} height={tileHeight} fit="cover" />
            </View>
          )}
          <View style={[StyleSheet.absoluteFill, OnPhoto.scrim]} />
          <View style={styles.tileLabel}>
            <Text style={styles.tileTag} numberOfLines={1}>
              #{tag.tag}
            </Text>
            <Text style={styles.tileCount}>{postCount(tag.postCount)}</Text>
          </View>
        </MotionPressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  // Ink shows behind a tag whose posts have no artwork image.
  tile: { borderRadius: Radius.card, overflow: "hidden", backgroundColor: Gallery.ink, justifyContent: "flex-end" },
  tileLabel: { paddingHorizontal: Spacing.compact, paddingBottom: Spacing.compact - 2 },
  tileTag: {
    fontFamily: Fonts.display,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
    color: Gallery.paper,
    ...OnPhoto.textShadow,
  },
  tileCount: { ...Typography.metadata, color: OnPhoto.muted, ...OnPhoto.textShadow },
});
