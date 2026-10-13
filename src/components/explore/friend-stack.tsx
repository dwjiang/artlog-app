import { StyleSheet, View } from "react-native";

import { ProfileAvatar } from "@/components/social/profile-avatar";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { friendNames } from "@/lib/explore/exhibition-timing";
import type { ExploreFriend } from "@/lib/explore/types";

/** Overlapping avatars (three, or `avatars`) and the friends' names; the enclosing control speaks for it. */
export function FriendStack({
  friends,
  size = 22,
  avatars = 3,
  suffix,
}: {
  friends: ExploreFriend[];
  size?: number;
  avatars?: number;
  suffix?: string;
}) {
  if (friends.length === 0) return null;
  const border = size > 24 ? 2 : 1.5;
  const ring = size + border * 2;
  return (
    <View style={styles.row} accessible={false}>
      <View style={styles.stack}>
        {friends.slice(0, avatars).map((friend, index) => (
          <View
            key={friend.profileId}
            style={[
              styles.ring,
              { borderWidth: border, borderRadius: ring / 2, marginLeft: index === 0 ? 0 : -size * 0.4 },
            ]}
          >
            <ProfileAvatar name={friend.name} photoUrl={friend.photoUrl} avatar={friend.avatar} size={size} />
          </View>
        ))}
      </View>
      <Text style={[styles.names, size > 24 && styles.large]} numberOfLines={2}>
        {suffix ? `${friendNames(friends)} ${suffix}` : friendNames(friends)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  stack: { flexDirection: "row" },
  ring: { borderColor: Gallery.paper },
  names: { fontSize: 13, lineHeight: 18, color: Gallery.ink, flexShrink: 1 },
  large: { fontSize: 15, lineHeight: 20 },
});
