import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { DisplayMedia } from "@/components/artwork/display-media";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing, Typography } from "@/constants/theme";
import { useSocialQuery } from "@/lib/social/use-social-query";
import type { SocialSession } from "@/lib/social/use-social-session";
import { useSafeAreaWidth } from "@/lib/ui/safe-area";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const GAP = 8;

/** Artworks on this person's wall that the viewer also saved, and museums they both visited. */
export function InCommonSection({ profileId, session }: { profileId: Id<"profiles">; session: SocialSession }) {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const width = useSafeAreaWidth();
  const readable = session.status === "ready" && !session.offline && profileId !== session.profileId;
  const { data } = useSocialQuery(api.suggestions.inCommonWith, readable ? { profileId } : "skip", session.key);
  if (!data || (data.artworks.length === 0 && data.museums.length === 0)) return null;
  const columns = fontScale > 1.4 ? 1 : 3;
  const tile = (width - Spacing.content * 2 - GAP * (columns - 1)) / columns;
  return (
    <View style={styles.section}>
      <Text variant="section" accessibilityRole="header">
        In common
      </Text>
      {data.artworks.length > 0 && (
        <View style={styles.grid}>
          {data.artworks.map(({ itemId, artwork }) => (
            <MotionPressable
              key={itemId}
              accessibilityRole="button"
              accessibilityLabel={`${artwork.title}, ${artwork.artist}`}
              onPress={() => router.push({ pathname: "/artwork", params: { kind: "wall", itemId } })}
              style={{ width: tile, gap: 6 }}
            >
              <DisplayMedia media={artwork.media} label={artwork.title} width={tile} height={tile} fit="cover" />
              <View>
                <Text style={styles.title} numberOfLines={2}>
                  {artwork.title}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {artwork.artist}
                </Text>
              </View>
            </MotionPressable>
          ))}
        </View>
      )}
      {data.museums.map((museum, index) => (
        <View key={museum.venueId} style={[styles.museum, index > 0 && styles.separated]} accessible>
          <Image source="sf:building.columns" tintColor={Gallery.ink} style={styles.icon} accessible={false} />
          <View style={{ flex: 1 }}>
            <Text>{museum.name}</Text>
            <Text style={styles.meta}>{museum.city ? `You both visited · ${museum.city}` : "You both visited"}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: Spacing.content,
    paddingTop: Spacing.compact,
    paddingBottom: Spacing.four,
    gap: Spacing.compact,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  title: { ...Typography.metadata, color: Gallery.ink },
  meta: { ...Typography.metadata, color: Gallery.muted },
  museum: { flexDirection: "row", alignItems: "center", gap: Spacing.compact, minHeight: 44 },
  separated: { borderTopWidth: 0.5, borderTopColor: Gallery.separator, paddingTop: Spacing.two },
  icon: { width: 20, height: 20 },
});
