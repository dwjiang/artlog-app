import { StyleSheet, View } from "react-native";

import { Gallery } from "@/constants/theme";
import type { PublicProfile } from "@/lib/social/types";

import { ProfileAvatar } from "./profile-avatar";

// Any string key, so preset paintings can stand in for people.
type Person = { profileId: string } & Partial<Pick<PublicProfile, "name" | "photoUrl" | "avatar">>;

/** Overlapping avatars, each ringed in paper so the overlap reads. */
export function AvatarStack({ people, size }: { people: readonly Person[]; size: number }) {
  return (
    <View style={styles.stack}>
      {people.map((person, index) => (
        <View
          key={person.profileId}
          style={[styles.ring, { borderRadius: size / 2 + 2 }, index > 0 && { marginLeft: -size / 3 }]}
        >
          <ProfileAvatar name={person.name} photoUrl={person.photoUrl} avatar={person.avatar} size={size} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { flexDirection: "row" },
  ring: { borderWidth: 1.5, borderColor: Gallery.paper },
});
