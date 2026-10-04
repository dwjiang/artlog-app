import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { FlatList, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { NativeSegmentedPicker } from "@/components/collection/native-segmented-picker";
import { SearchEmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/loading-skeleton";
import { usePaneRoom, usePaneSwitch } from "@/components/pane-scroll";
import { SearchField } from "@/components/search-field";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { peopleSearch } from "@/lib/social/presentation";
import type { BrowsedProfile, PublicProfile } from "@/lib/social/types";
import { useFriends } from "@/lib/social/use-friends";
import { useCursorPages, useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { useSuggestions } from "@/lib/social/use-suggestions";
import { LIMITS } from "@/shared/journal/limits";

import { api } from "../../../convex/_generated/api";
import { FriendsInvitation } from "./friends-invitation";
import { CompactFriendshipControls } from "./friendship-controls";
import { SocialInvitation } from "./social-invitation";
import { PageFooter, SocialGate, SocialState } from "./social-state";
import { socialStyles } from "./social-styles";
import { SuggestionList } from "./suggested-people";
import { ProfileIdentity } from "./visit-card";

const searchPage = (result: { page: BrowsedProfile[]; cursor: string | null; isDone: boolean }) => result;
const profileId = (profile: PublicProfile) => profile.profileId;

export function PeopleScreen() {
  const session = useSocialSession();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<"all" | "friends">(params.filter === "friends" ? "friends" : "all");
  const guestFriends = filter === "friends" && session.status === "signed-out";
  const friends = useFriends(session, session.profileId);
  const requests = useSocialQuery(api.profiles.requests, session.status === "ready" ? {} : "skip", session.key);
  const [text, setText] = useState("");
  const debounced = useDebouncedValue(text, 300, "");
  const query = peopleSearch(debounced);
  const searching = text === debounced && !!query && !session.offline;
  const results = useCursorPages(
    api.profiles.search,
    searching ? { query: query! } : "skip",
    session.key,
    searchPage,
    profileId,
  );
  const discovery = useCursorPages(
    api.profiles.discover,
    !text.trim() && !session.offline ? {} : "skip",
    session.key,
    searchPage,
    profileId,
  );
  const emptyFriends =
    filter === "friends"
    && session.status === "ready"
    && !friends.loading
    && !friends.error
    && friends.data?.length === 0
    && !text.trim();
  const explore = () => {
    setText("");
    setFilter("all");
  };
  const people = searching ? results : discovery;
  const suggestions = useSuggestions(session);
  const exploring = filter === "all" && !text.trim();
  // People already listed under Requests or Suggested are not repeated among the newest profiles.
  const listedAbove = new Set([
    ...(requests.data ?? []).map(profileId),
    ...suggestions.people.map((person) => person.profile.profileId),
  ]);
  const newest = discovery.items.filter((person) => !listedAbove.has(person.profileId));
  const changed = () => {
    friends.refresh();
    requests.refresh();
    suggestions.refresh();
  };
  // Browse pages embed the viewer's relationship per row; a row only opens its own subscription when a page lacks it.
  const relationship = (person: BrowsedProfile, refresh: () => void) =>
    person.relationship ? { data: person.relationship, refresh } : undefined;
  const list = useRef<FlatList<BrowsedProfile>>(null);
  const room = usePaneRoom(list);
  usePaneSwitch(filter, () => room);
  return (
    <>
      <Stack.Screen options={{ title: "" }} />
      {session.status === "ready" && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="qrcode"
            accessibilityLabel="Share your profile"
            tintColor={Gallery.ink}
            hidesSharedBackground
            onPress={() => router.push("/share-profile")}
          />
        </Stack.Toolbar>
      )}
      <FlatList
        ref={list}
        style={socialStyles.root}
        contentContainerStyle={[socialStyles.content, { minHeight: room.minHeight }]}
        contentInsetAdjustmentBehavior="automatic"
        onLayout={room.onLayout}
        onScroll={room.onScroll}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        data={
          guestFriends
            ? []
            : filter === "friends"
              ? (friends.data ?? []).filter(
                  (person) =>
                    !text.trim()
                    || `${person.name} ${person.username}`.toLowerCase().includes(text.trim().toLowerCase()),
                )
              : searching
                ? results.items
                : !text.trim()
                  ? newest
                  : []
        }
        keyExtractor={profileId}
        renderItem={({ item }: { item: BrowsedProfile }) => (
          <View
            style={{
              paddingHorizontal: 20,
              paddingVertical: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <ProfileIdentity profile={item} />
            </View>
            <CompactFriendshipControls
              onChanged={changed}
              profileId={item.profileId}
              session={session}
              relationship={relationship(item, people.refresh)}
              friend={
                filter === "friends"
                || item.relationship?.state === "accepted"
                || friends.data?.some((friend) => friend.profileId === item.profileId)
              }
            />
          </View>
        )}
        ListHeaderComponent={
          <>
            <View
              style={{
                paddingHorizontal: 20,
                paddingTop: 4,
                paddingBottom: 12,
                gap: 12,
              }}
            >
              <Text variant="pageTitle" accessibilityRole="header">
                Friends
              </Text>
              <SearchField
                filled
                label="Name or username"
                value={text}
                onChange={setText}
                onClear={() => setText("")}
                showLabel={false}
                editable={filter === "all" || session.status === "ready"}
              />
              {/* Requests and the friend count below the switch belong to one filter each. */}
              <View onLayout={room.onHeaderLayout}>
                <NativeSegmentedPicker
                  label="Friends filter"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: "Explore" },
                    { value: "friends", label: "Friends" },
                  ]}
                />
              </View>
              {exploring && !!requests.data?.length && (
                <View style={{ gap: 10, paddingTop: 12 }}>
                  <Text variant="section" accessibilityRole="header">
                    Requests
                  </Text>
                  {requests.data.map((person) => (
                    <View
                      key={person.profileId}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <ProfileIdentity profile={person} />
                      </View>
                      <CompactFriendshipControls
                        onChanged={changed}
                        profileId={person.profileId}
                        session={session}
                        relationship={relationship(person, requests.refresh)}
                        declinable
                      />
                    </View>
                  ))}
                </View>
              )}
              {filter === "friends" && !!friends.data?.length && (
                <Text variant="section">
                  Your friends <Text style={{ color: Gallery.muted }}>{friends.data.length}</Text>
                </Text>
              )}
              {exploring && requests.error && (
                <GalleryButton label="Retry friend requests" onPress={requests.refresh} />
              )}
            </View>
            {exploring && (
              <SuggestionList
                people={suggestions.people}
                session={session}
                onDismiss={suggestions.dismiss}
                refresh={suggestions.refresh}
              />
            )}
            {exploring && newest.length > 0 && listedAbove.size > 0 && (
              <Text variant="section" accessibilityRole="header" style={{ paddingHorizontal: 20, paddingTop: 24 }}>
                New on Artlog
              </Text>
            )}
          </>
        }
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: 0.5,
              marginHorizontal: 24,
              backgroundColor: Gallery.separator,
            }}
          />
        )}
        ListEmptyComponent={
          guestFriends ? (
            <FriendsInvitation onExplore={explore} />
          ) : filter === "friends" ? (
            session.status !== "ready" ? (
              <SocialGate session={session} />
            ) : friends.loading && !friends.error ? (
              <ListSkeleton label="Opening friends…" avatar />
            ) : friends.error ? (
              <SocialState title="Couldn’t load your friends." action="Try again" onAction={friends.refresh} />
            ) : emptyFriends ? (
              <SocialInvitation
                title={"No friends added yet."}
                detail="Search by name or username to add your first friend."
              >
                <GalleryButton label="Find friends" variant="filled" fullWidth onPress={explore} />
              </SocialInvitation>
            ) : text.trim() ? (
              <SearchEmptyState
                title="No friends found."
                detail="Try another name or username."
                onClear={() => setText("")}
              />
            ) : null
          ) : session.offline ? (
            <SocialState title="You’re offline." detail="Connect to find friends." icon="wifi.slash" />
          ) : !text.trim() ? (
            discovery.done && !discovery.loading && !discovery.error && discovery.items.length === 0 ? (
              <SocialInvitation
                title={"No public profiles yet."}
                detail="Profiles will appear here when people create them."
              >
                <GalleryButton
                  label="Scan artwork"
                  variant="filled"
                  fullWidth
                  onPress={() => {
                    router.dismissAll();
                    router.navigate("/scan");
                  }}
                />
              </SocialInvitation>
            ) : null
          ) : !peopleSearch(text) ? (
            <SocialState
              title="Check your search."
              icon="person.2"
              detail={`Search by name or username. Use ${LIMITS.searchMin}–${LIMITS.searchMax} characters and up to 16 words.`}
            />
          ) : text !== debounced ? (
            <ListSkeleton label="Searching…" avatar />
          ) : results.done && !results.loading && !results.error ? (
            <SearchEmptyState
              title="No friends found."
              detail="Try another name or username."
              onClear={() => setText("")}
            />
          ) : null
        }
        ListFooterComponent={
          filter === "all" ? (
            searching ? (
              <PageFooter {...results} count={results.items.length} noun="friends" />
            ) : !text.trim() ? (
              discovery.done && !discovery.error ? (
                discovery.items.length > 0 ? (
                  <Text style={{ padding: 20, color: Gallery.muted, fontSize: 13 }}>Search by name or username.</Text>
                ) : null
              ) : (
                <PageFooter {...discovery} count={discovery.items.length} noun="friends" />
              )
            ) : null
          ) : null
        }
        onEndReached={
          filter === "all" ? (searching ? results.loadMore : !text.trim() ? discovery.loadMore : undefined) : undefined
        }
        onEndReachedThreshold={0.4}
      />
    </>
  );
}
