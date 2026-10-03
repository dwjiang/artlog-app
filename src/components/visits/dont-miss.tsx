import { Image } from "expo-image";
import { router } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";

import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { useMuseumPicks } from "@/lib/venue/use-museum-picks";

/** Works worth finding at the museum on Home's Now card, as a row to swipe through. Hidden when there are none. */
export function DontMiss({ venueId }: { venueId: string | undefined }) {
  const picks = useMuseumPicks(venueId);
  if (!venueId || picks.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text variant="section" accessibilityRole="header" style={styles.heading}>
        Don’t miss
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {picks.map((pick) => (
          <MotionPressable
            key={pick.artworkId}
            accessibilityRole="button"
            accessibilityLabel={`${pick.title}, ${pick.artist}`}
            onPress={() => router.push({ pathname: "/dont-miss", params: { venueId, artworkId: pick.artworkId } })}
            style={styles.card}
          >
            <Image source={pick.thumbnailUrl} contentFit="cover" style={styles.image} accessible={false} />
            <Text numberOfLines={2} style={styles.title}>
              {pick.title}
            </Text>
            <Text numberOfLines={1} type="small" themeColor="textSecondary">
              {pick.artist}
            </Text>
          </MotionPressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: Spacing.three, paddingBottom: Spacing.three },
  heading: { paddingHorizontal: Spacing.content, paddingBottom: Spacing.two },
  row: { paddingHorizontal: Spacing.content, gap: Spacing.compact },
  card: { width: 150, gap: 2 },
  image: { width: 150, height: 118, borderRadius: Radius.thumbnail, backgroundColor: Gallery.fill, marginBottom: 6 },
  title: { fontSize: 14, lineHeight: 18, fontWeight: "600", color: Gallery.ink },
});
