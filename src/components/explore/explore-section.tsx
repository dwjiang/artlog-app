import type { ReactNode } from "react";
import { FlatList, StyleSheet, View, useWindowDimensions, type FlatListProps } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useSafeAreaBleed } from "@/lib/ui/safe-area";

const SHELF_GAP = Spacing.compact;

/** A section heading with See all; `heading` replaces the plain title, as the timing menu does. */
export function ExploreSectionHeading({
  title,
  heading,
  onSeeAll,
}: {
  title: string;
  heading?: ReactNode;
  onSeeAll: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <View style={[styles.heading, fontScale > 1.4 && styles.stacked]}>
      <View style={styles.title}>
        {heading ?? (
          <Text variant="section" accessibilityRole="header">
            {title}
          </Text>
        )}
      </View>
      <GalleryButton label="See all" accessibilityLabel={`See all: ${title}`} fullWidth={false} onPress={onSeeAll} />
    </View>
  );
}

/**
 * Stops a shelf only at multiples of one item and its gap. The shelf's leading padding is outside those steps, so every
 * stop rests an item's leading edge on the content inset, as App Store shelves do.
 */
export function shelfSnapProps(itemWidth: number) {
  return { snapToInterval: itemWidth + SHELF_GAP, snapToAlignment: "start", decelerationRate: "fast" } as const;
}

/** A sideways row of items `itemWidth` wide that runs under the side bars to the screen edges. */
export function ExploreShelf<T>({ itemWidth, ...props }: Omit<FlatListProps<T>, "horizontal"> & { itemWidth: number }) {
  const bleed = useSafeAreaBleed(styles.shelf);
  return (
    <FlatList
      horizontal
      showsHorizontalScrollIndicator={false}
      style={bleed.style}
      contentContainerStyle={bleed.contentContainerStyle}
      {...shelfSnapProps(itemWidth)}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    paddingLeft: Spacing.content,
    paddingRight: Spacing.compact,
    minHeight: 44,
  },
  stacked: { flexDirection: "column", alignItems: "flex-start", gap: 0 },
  title: { flexShrink: 1, maxWidth: "100%" },
  shelf: { gap: SHELF_GAP, paddingHorizontal: Spacing.content },
});
