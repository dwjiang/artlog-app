import { Stack } from "expo-router";
import { FlatList, StyleSheet, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeleton";
import { Gallery } from "@/constants/theme";
import type { BrowsedProfile } from "@/lib/social/types";
import { isMutualFriend, useFriends } from "@/lib/social/use-friends";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CompactFriendshipControls } from "./friendship-controls";
import { SocialGate, SocialState } from "./social-state";
import { socialStyles } from "./social-styles";
import { ProfileIdentity } from "./visit-card";

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
  if (session.status !== "ready") return <SocialGate session={session} />;
  const firstName = person.data?.name.split(" ")[0];
  const rank = (p: BrowsedProfile) => (p.profileId === session.profileId ? 0 : isMutualFriend(p) ? 1 : 2);
  // Stable sort keeps the server's alphabetical order within each group.
  const people = friends.data && [...friends.data].sort((a, b) => rank(a) - rank(b));
  return (
    <>
      <Stack.Screen options={{ title: firstName ? `${firstName}’s friends` : "Friends" }} />
      <FlatList
        style={socialStyles.root}
        contentContainerStyle={socialStyles.content}
        contentInsetAdjustmentBehavior="automatic"
        data={people ?? []}
        keyExtractor={(item) => item.profileId}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <ProfileIdentity profile={item} />
            </View>
            <CompactFriendshipControls
              profileId={item.profileId}
              session={session}
              friend={isMutualFriend(item)}
              relationship={item.relationship && { data: item.relationship, refresh: friends.refresh }}
            />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          friends.error ? (
            <SocialState title="Couldn’t load friends." action="Try again" onAction={friends.refresh} />
          ) : friends.data === null ? (
            <SocialState title="Friends unavailable." detail="This profile is no longer available." />
          ) : friends.loading ? (
            <ListSkeleton label="Opening friends…" avatar />
          ) : (
            <EmptyState title="No friends yet." />
          )
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  separator: { height: 0.5, marginHorizontal: 24, backgroundColor: Gallery.separator },
});
