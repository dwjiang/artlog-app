import { StyleSheet, View } from "react-native";

import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Fonts, Gallery, Radius, Spacing } from "@/constants/theme";
import { exhibitionStatus, friendNames, isClosed } from "@/lib/explore/exhibition-timing";
import type { Exhibition, ExploreMuseum } from "@/lib/explore/types";

import { ExhibitionStatusLine } from "./exhibition-status";
import { ExploreImage } from "./explore-image";
import { openExhibition } from "./explore-routes";
import { FriendStack } from "./friend-stack";
import { WantToSeeButton } from "./want-to-see-button";

/**
 * A show as a list row, with Want to see; a closed show recedes into gray. `museum` adds the museum's name to the status
 * line, for lists that mix museums.
 */
export function ExhibitionRow({
  exhibition,
  today,
  museum,
  thumbnail = 72,
  separator = true,
}: {
  exhibition: Exhibition;
  today: string;
  museum?: ExploreMuseum;
  thumbnail?: number;
  separator?: boolean;
}) {
  const status = exhibitionStatus(exhibition, today);
  const closed = isClosed(exhibition, today);
  const place = museum ? `, ${museum.name}` : "";
  const friends = exhibition.friends.length > 0 ? `, ${friendNames(exhibition.friends)} want to see it` : "";
  return (
    <View style={styles.row}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={`${exhibition.title}, ${status.label}${place}${friends}`}
        onPress={() => openExhibition(exhibition.id)}
        style={styles.content}
      >
        <View style={[styles.thumbnail, { width: thumbnail, height: thumbnail }, closed && styles.closedImage]}>
          <ExploreImage image={exhibition.image} style={StyleSheet.absoluteFill} />
          {closed && <View style={styles.grayscale} />}
        </View>
        <View style={[styles.text, separator && styles.separator]}>
          <Text style={[styles.title, closed && styles.closedTitle]} numberOfLines={1}>
            {exhibition.title}
          </Text>
          <ExhibitionStatusLine status={status} detail={museum?.name} />
          <FriendStack friends={exhibition.friends} />
        </View>
      </MotionPressable>
      <View style={[styles.accessory, separator && styles.separator]}>
        <WantToSeeButton exhibition={exhibition} closed={closed} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch", paddingLeft: Spacing.content, paddingRight: Spacing.two },
  content: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.compact },
  thumbnail: { borderRadius: Radius.thumbnail, marginVertical: 10, overflow: "hidden" },
  text: { flex: 1, alignSelf: "stretch", justifyContent: "center", gap: 4, paddingVertical: 10 },
  separator: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  accessory: { justifyContent: "center" },
  title: { fontFamily: Fonts.display, fontSize: 16, lineHeight: 21, letterSpacing: -0.2, color: Gallery.ink },
  closedImage: { opacity: 0.55 },
  // A colorless layer in saturation blend keeps only the brightness below it; RN's grayscale filter is off on iOS.
  grayscale: { position: "absolute", inset: 0, backgroundColor: "white", mixBlendMode: "saturation" },
  closedTitle: { color: Gallery.muted },
});
