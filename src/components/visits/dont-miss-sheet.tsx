import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { useFittedFormSheetStyle } from "@/hooks/use-fitted-sheet";
import { artistLine } from "@/lib/catalog/artist-line";
import { useMuseumPick } from "@/lib/venue/use-museum-picks";

/** A larger look at one "Don't miss" work, so it is easier to spot in the galleries. */
export function DontMissSheet() {
  const { venueId, artworkId } = useLocalSearchParams<{ venueId: string; artworkId: string }>();
  const { pick, loading, error } = useMuseumPick(venueId, artworkId);
  const sheetStyle = [styles.container, useFittedFormSheetStyle()];
  return (
    <ScrollView style={sheetStyle} contentContainerStyle={styles.content} bounces={false}>
      {pick ? (
        <>
          <Image
            source={pick.thumbnailUrl}
            contentFit="contain"
            style={styles.image}
            accessibilityLabel={`${pick.title}, ${pick.artist}`}
          />
          <Text variant="section" accessibilityRole="header">
            {pick.title}
          </Text>
          <Text variant="secondary" themeColor="textSecondary">
            {artistLine(pick.artist, pick.date)}
          </Text>
          {pick.medium && (
            <Text type="small" themeColor="textSecondary">
              {pick.medium}
            </Text>
          )}
          {pick.savers > 1 && (
            <Text type="small" themeColor="textSecondary">
              Saved here by {pick.savers} people
            </Text>
          )}
        </>
      ) : loading ? (
        <LoadingRing accessibilityLabel="Loading the artwork" style={styles.loading} />
      ) : (
        <>
          <Text>{error ? "This artwork could not load." : "This artwork is unavailable."}</Text>
          <GalleryButton label="Done" onPress={() => router.back()} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: Colors.light.background },
  content: { padding: Spacing.content, paddingTop: Spacing.four, gap: Spacing.two },
  image: { width: "100%", height: 280, marginBottom: Spacing.two },
  loading: { height: 280 },
});
