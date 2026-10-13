import { StyleSheet, View } from "react-native";

import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Fonts, Gallery, Spacing } from "@/constants/theme";
import { exhibitionStatus, friendNames } from "@/lib/explore/exhibition-timing";
import type { Exhibition, ExploreMuseum } from "@/lib/explore/types";

import { ExhibitionStatusLine } from "./exhibition-status";
import { ExploreImage } from "./explore-image";
import { openExhibition } from "./explore-routes";
import { FriendStack } from "./friend-stack";
import { WantToSeeButton } from "./want-to-see-button";

const CARD_WIDTH = 216;

/** A show in a sideways row: its artwork, title, museum, timing and the friends who want to see it. */
export function ExhibitionCard({
  exhibition,
  museum,
  today,
}: {
  exhibition: Exhibition;
  museum: ExploreMuseum | undefined;
  today: string;
}) {
  const status = exhibitionStatus(exhibition, today);
  const friends = exhibition.friends.length > 0 ? `, ${friendNames(exhibition.friends)} want to see it` : "";
  return (
    <View style={styles.card}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={`${exhibition.title}, ${museum?.name ?? ""}, ${status.label}${friends}`}
        onPress={() => openExhibition(exhibition.id)}
        style={styles.content}
      >
        <ExploreImage image={exhibition.image} style={styles.image} />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={2}>
            {exhibition.title}
          </Text>
          {museum && (
            <Text style={styles.museum} numberOfLines={1}>
              {museum.name}
            </Text>
          )}
          <ExhibitionStatusLine status={status} />
        </View>
        <FriendStack friends={exhibition.friends} size={20} avatars={2} />
      </MotionPressable>
      <WantToSeeButton exhibition={exhibition} overlay />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: CARD_WIDTH },
  content: { gap: Spacing.two },
  image: { width: CARD_WIDTH, height: CARD_WIDTH },
  text: { gap: 2, paddingTop: 2 },
  title: { fontFamily: Fonts.display, fontSize: 17, lineHeight: 22, letterSpacing: -0.2, color: Gallery.ink },
  museum: { fontSize: 14, lineHeight: 21, color: Gallery.muted },
});
