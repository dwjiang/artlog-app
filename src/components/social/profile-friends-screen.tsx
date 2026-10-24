import { Stack } from "expo-router";
import { StyleSheet, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeleton";
import { SafeAreaFlatList } from "@/components/safe-area-scroll";
import { Gallery, Spacing } from "@/constants/theme";
import type { BrowsedProfile } from "@/lib/social/types";
import { isMutualFriend, useFriends } from "@/lib/social/use-friends";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CompactFriendshipControls } from "./friendship-controls";
import { ProfileRow } from "./profile-row";
import { SocialGate, SocialState, StateScreen } from "./social-state";
import { socialStyles } from "./social-styles";

/** Someone else's friends: you first when you're one of them, then the friends you share, then everyone else. */
export function ProfileFriendsScreen({ profileId }: { profileId: string }) {
  const session = useSocialSession();
  const id = profileId ? (profileId as Id<"profiles">) : undefined;
  const friends = useFriends(session, id);
  const person = useSocialQuery(
    api.profiles.getPublic,
    id && session.status === "ready" ? { profileId: id } : "skip",
    session.key,
  );
  if (session.status !== "ready") {
    return (
      <StateScreen grouped>
        <SocialGate session={session} />
      </StateScreen>
    );
  }
  const firstName = person.data?.name.split(" ")[0];
  const rank = (p: BrowsedProfile) => (p.profileId === session.profileId ? 0 : isMutualFriend(p) ? 1 : 2);
  // Stable sort keeps the server's alphabetical order within each group.
  const people = friends.data ? [...friends.data].sort((a, b) => rank(a) - rank(b)) : [];
  return (
    <>
      <Stack.Screen options={{ title: firstName ? `${firstName}’s Friends` : "Friends" }} />
      <SafeAreaFlatList
        style={styles.page}
        contentContainerStyle={[socialStyles.content, styles.content, people.length === 0 && { paddingBottom: 0 }]}
        contentInsetAdjustmentBehavior="automatic"
        bounces={people.length > 0}
        data={people}
        keyExtractor={(item) => item.profileId}
        renderItem={({ item, index }) => (
          <View style={styles.inset}>
            <ProfileRow
              profile={item}
              first={index === 0}
              last={index === people.length - 1}
              trailing={
                <CompactFriendshipControls
                  profileId={item.profileId}
                  session={session}
                  friend={isMutualFriend(item)}
                  relationship={item.relationship && { data: item.relationship, refresh: friends.refresh }}
                />
              }
            />
          </View>
        )}
        ListEmptyComponent={
          friends.error ? (
            <SocialState title="Couldn’t load friends." action="Try again" onAction={friends.refresh} />
          ) : friends.data === null ? (
            <SocialState title="Friends unavailable." detail="This profile is no longer available." />
          ) : friends.loading ? (
            <View style={styles.inset}>
              <ListSkeleton card label="Opening friends…" avatar />
            </View>
          ) : (
            <EmptyState title="No friends yet." />
          )
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Gallery.groupedBackground },
  content: { paddingTop: Spacing.three },
  inset: { paddingHorizontal: Spacing.content },
});
