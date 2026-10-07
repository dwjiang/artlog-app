import { Fragment } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import type { PublicProfile } from "@/lib/social/types";

import { AvatarStack } from "./avatar-stack";
import { profileHref, TextLink } from "./tagged-text";

/** What comes before the name at `index` in a list of `count`: "A and B", "A, B, and C". */
const separator = (index: number, count: number) =>
  index === 0 ? "" : index < count - 1 ? ", " : count > 2 ? ", and " : " and ";
export const joinNames = (names: readonly string[]) =>
  names.map((name, index) => separator(index, names.length) + name).join("");

/** The friends a visit's author went with; each name opens that person's profile. */
export function WentWithLine({ people, style }: { people: readonly PublicProfile[]; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.row, style]}>
      <AvatarStack people={people.slice(0, 3)} size={16} />
      <Text style={styles.text}>
        {"with "}
        {people.map((person, index) => (
          <Fragment key={person.profileId}>
            {separator(index, people.length)}
            <TextLink href={profileHref(person.profileId)} accessibilityHint="Opens their profile" style={styles.name}>
              {person.name}
            </TextLink>
          </Fragment>
        ))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { flexShrink: 1, fontSize: 12, lineHeight: 18, color: Gallery.muted },
  name: { fontWeight: "600", color: Gallery.ink },
});
