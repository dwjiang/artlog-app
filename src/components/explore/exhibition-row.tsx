import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { LoadingImage } from "@/components/loading-image";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Fonts, Gallery, Radius, Spacing } from "@/constants/theme";
import { exhibitionStatus, friendNames } from "@/lib/explore/exhibition-timing";
import type { Exhibition, ExploreMuseum } from "@/lib/explore/types";

import { ExhibitionStatusLine } from "./exhibition-status";
import { openExhibition } from "./explore-routes";
import { FriendStack } from "./friend-stack";
import { ReminderButton, WantToSeeButton } from "./plan-buttons";

/**
 * A show as a list row. Shows that have not opened take a reminder bell; the rest take Want to see. `museum` adds the
 * museum's name to the status line, for lists that mix museums.
 */
export function ExhibitionRow({
  exhibition,
  today,
  museum,
  thumbnail = 72,
  separator = true,
  accessory,
}: {
  exhibition: Exhibition;
  today: string;
  museum?: ExploreMuseum;
  thumbnail?: number;
  separator?: boolean;
  accessory?: ReactNode;
}) {
  const status = exhibitionStatus(exhibition, today);
  const place = museum ? `, ${museum.shortName}` : "";
  const friends = exhibition.friends.length > 0 ? `, ${friendNames(exhibition.friends)} want to see it` : "";
  return (
    <View style={styles.row}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={`${exhibition.title}, ${status.label}${place}${friends}`}
        onPress={() => openExhibition(exhibition.id)}
        style={styles.content}
      >
        <LoadingImage
          uri={exhibition.image.uri}
          label={exhibition.image.label}
          style={[styles.thumbnail, { width: thumbnail, height: thumbnail }]}
        />
        <View style={[styles.text, separator && styles.separator]}>
          <Text style={styles.title} numberOfLines={1}>
            {exhibition.title}
          </Text>
          <ExhibitionStatusLine status={status} detail={museum?.shortName} />
          <FriendStack friends={exhibition.friends} />
        </View>
      </MotionPressable>
      <View style={[styles.accessory, separator && styles.separator]}>
        {accessory
          ?? (exhibition.startsOn > today ? (
            <ReminderButton exhibition={exhibition} />
          ) : (
            <WantToSeeButton exhibition={exhibition} />
          ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch", paddingLeft: Spacing.content, paddingRight: Spacing.two },
  content: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.compact },
  thumbnail: { borderRadius: Radius.thumbnail, marginVertical: 10 },
  text: { flex: 1, alignSelf: "stretch", justifyContent: "center", gap: 4, paddingVertical: 10 },
  separator: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  accessory: { justifyContent: "center" },
  title: { fontFamily: Fonts.display, fontSize: 16, lineHeight: 21, letterSpacing: -0.2, color: Gallery.ink },
});
