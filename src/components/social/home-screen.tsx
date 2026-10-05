import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { use, useRef, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";

import { WelcomePrompt } from "@/components/account/welcome-prompt";
import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { NativeSegmentedPicker } from "@/components/collection/native-segmented-picker";
import { FeedSkeleton } from "@/components/loading-skeleton";
import { usePaneRoom, usePaneSwitch } from "@/components/pane-scroll";
import { usePullToRefresh } from "@/components/pull-to-refresh";
import { ThemedText as Text } from "@/components/themed-text";
import { NowCard } from "@/components/visits/now-card";
import { WrapUpPrompt } from "@/components/visits/wrap-up-prompt";
import { Gallery, Spacing } from "@/constants/theme";
import { signInRoute } from "@/lib/account/sign-in-context";
import type { SharedVisit } from "@/lib/social/types";
import { UnseenNotificationCount } from "@/lib/social/unseen-notifications";
import { useBlock } from "@/lib/social/use-block";
import { useCursorPages, useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { useSuggestions } from "@/lib/social/use-suggestions";

import { api } from "../../../convex/_generated/api";
import { HomeToolbar } from "./home-toolbar";
import { SocialInvitation } from "./social-invitation";
import { PageFooter, SocialGate } from "./social-state";
import { socialStyles } from "./social-styles";
import { SuggestionList, SuggestionStrip } from "./suggested-people";
import { VisitCard } from "./visit-card";

// Suggestions sit above the Friends feed only until there are enough friends for the feed to carry the screen.
const STRIP_FRIEND_LIMIT = 5;
const feedPage = (result: { page: SharedVisit[]; cursor: string | null; isDone: boolean }) => result;
const visitId = (visit: SharedVisit) => visit.postId;
type FeedTab = "friends" | "global";

export function HomeScreen() {
  const [dismissedPrompt, setDismissedPrompt] = useState(false);
  const [chosenTab, setChosenTab] = useState<FeedTab>();
  // Posting a visit returns here naming the feed it landed in; each post carries its own stamp so a repeat lands too.
  const { feed: requestedFeed, posted } = useLocalSearchParams<{ feed?: string; posted?: string }>();
  const [appliedPost, setAppliedPost] = useState<string>();
  const request = posted && (requestedFeed === "friends" || requestedFeed === "global") ? posted : undefined;
  if (request && request !== appliedPost) {
    setAppliedPost(request);
    setChosenTab(requestedFeed as FeedTab);
  }
  const session = useSocialSession();
  const blocking = useBlock(session);
  const guest = session.status === "signed-out";
  // Friends needs a profile; Global is open to guests and to accounts that have not created one yet.
  const canBrowseFriends = session.status === "ready";
  const canBrowseGlobal = canBrowseFriends || guest || session.status === "profile-required";
  // Keep both subscriptions alive so switching feeds retains loaded pages instead of flashing the skeleton.
  const friendsFeed = useCursorPages(
    api.sharedVisits.listFeed,
    canBrowseFriends ? {} : "skip",
    session.key,
    feedPage,
    visitId,
  );
  const globalFeed = useCursorPages(
    api.sharedVisits.listPublic,
    canBrowseGlobal ? {} : "skip",
    session.key,
    feedPage,
    visitId,
  );
  // Profiles land on Friends only when it has visits. The first answer sticks so a later friend post cannot pull the
  // reader off Global.
  const [landing, setLanding] = useState<{ profileId: typeof session.profileId; tab: FeedTab }>();
  const friendsLanding =
    friendsFeed.items.length > 0 || friendsFeed.error ? "friends" : friendsFeed.done ? "global" : undefined;
  if (canBrowseFriends && friendsLanding && landing?.profileId !== session.profileId) {
    setLanding({ profileId: session.profileId, tab: friendsLanding });
  }
  const landed = landing && landing.profileId === session.profileId ? landing.tab : undefined;
  const tab = chosenTab ?? (canBrowseFriends ? landed : session.status === "loading" ? undefined : "global");
  const canBrowse = tab === "global" ? canBrowseGlobal : canBrowseFriends;
  const feed = tab === "global" ? globalFeed : friendsFeed;
  const router = useRouter();
  const requests = useSocialQuery(api.profiles.requests, canBrowseFriends ? {} : "skip", session.key).data?.length ?? 0;
  const unseen = use(UnseenNotificationCount);
  const suggestions = useSuggestions(session);
  const suggestionActions = {
    session,
    onDismiss: suggestions.dismiss,
    refresh: suggestions.refresh,
    seeAll: () => router.push("/people"),
  };
  const showStrip =
    tab === "friends"
    && friendsFeed.items.length > 0
    && suggestions.friendCount !== undefined
    && suggestions.friendCount < STRIP_FRIEND_LIMIT
    && suggestions.people.length > 0;
  const list = useRef<FlatList<SharedVisit>>(null);
  const room = usePaneRoom(list);
  usePaneSwitch(tab ?? "", () => room);
  const pull = usePullToRefresh({
    enabled: canBrowse,
    refreshing: feed.refreshing,
    onRefresh: feed.refresh,
  });
  return (
    <>
      {/* Guests see these too; each page asks them to sign in. */}
      <HomeToolbar requests={requests} unseen={unseen} />
      <WelcomePrompt />
      <WrapUpPrompt />
      <FlatList
        ref={list}
        style={socialStyles.root}
        contentContainerStyle={[socialStyles.content, { paddingBottom: 28, minHeight: room.minHeight }]}
        contentInsetAdjustmentBehavior="automatic"
        onLayout={room.onLayout}
        onScroll={room.onScroll}
        data={canBrowse ? feed.items : []}
        keyExtractor={visitId}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        renderItem={({ item }) => (
          <VisitCard
            visit={item}
            token={session.token}
            viewerProfileId={session.profileId}
            onBlock={session.status === "ready" ? blocking.block : undefined}
          />
        )}
        refreshControl={pull.refreshControl}
        ListHeaderComponentStyle={styles.header}
        ListHeaderComponent={
          <>
            {guest && !dismissedPrompt && (
              <View
                style={{
                  marginHorizontal: 20,
                  marginBottom: 16,
                  paddingLeft: 12,
                  paddingVertical: 6,
                  backgroundColor: Gallery.highlight,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Image source="sf:person.2" tintColor={Gallery.accent} style={{ width: 22, height: 22 }} />
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    lineHeight: 18,
                    color: Gallery.muted,
                  }}
                >
                  Sign in to connect with friends.
                </Text>
                <GalleryButton label="Sign in" onPress={() => router.push(signInRoute("friends"))} />
                <GalleryIconButton
                  label="Dismiss sign-in invitation"
                  icon="xmark"
                  onPress={() => setDismissedPrompt(true)}
                />
              </View>
            )}
            <NowCard />
            {/* Each feed starts below the switch; the suggestion strip under it belongs to Friends. */}
            <View style={styles.tabs} onLayout={room.onHeaderLayout}>
              <NativeSegmentedPicker
                label="Visit feed"
                value={tab}
                onChange={setChosenTab}
                options={[
                  { value: "friends", label: "Friends" },
                  { value: "global", label: "Global" },
                ]}
              />
            </View>
            {showStrip && <SuggestionStrip people={suggestions.people} {...suggestionActions} />}
          </>
        }
        ListEmptyComponent={
          !canBrowse ? (
            session.status === "loading" ? (
              <FeedSkeleton label="Loading your account…" />
            ) : (
              <SocialGate session={session} onBrowseGlobal={() => setChosenTab("global")} />
            )
          ) : feed.done && !feed.loading && !feed.error ? (
            tab === "global" ? (
              <SocialInvitation
                title="No public visits yet."
                detail="View public walls to see other people’s collections."
              >
                <ActionStack
                  textActions={
                    <GalleryButton label="Scan an artwork" fullWidth onPress={() => router.navigate("/scan")} />
                  }
                >
                  <GalleryButton
                    label="View public walls"
                    variant="filled"
                    fullWidth
                    onPress={() => router.push("/people")}
                  />
                </ActionStack>
              </SocialInvitation>
            ) : suggestions.people.length > 0 ? (
              <View>
                <View style={styles.emptyFeed}>
                  <Text variant="section" accessibilityRole="header">
                    No visits from friends yet.
                  </Text>
                  <Text themeColor="textSecondary">Add friends to see the museum visits they share.</Text>
                </View>
                <SuggestionList people={suggestions.people.slice(0, 5)} {...suggestionActions} />
                <View style={styles.emptyFeedAction}>
                  <GalleryButton
                    label="Share your profile"
                    icon="qrcode"
                    variant="outlined"
                    fullWidth
                    onPress={() => router.push("/share-profile")}
                  />
                </View>
              </View>
            ) : (
              <SocialInvitation
                title="No visits from friends yet."
                detail="Add friends to see the museum visits they share."
              >
                <ActionStack
                  textActions={<GalleryButton label="Browse Global" fullWidth onPress={() => setChosenTab("global")} />}
                >
                  <GalleryButton
                    label="Find friends"
                    variant="filled"
                    fullWidth
                    onPress={() => router.push("/people")}
                  />
                </ActionStack>
              </SocialInvitation>
            )
          ) : null
        }
        ListFooterComponent={
          canBrowse && !(feed.refreshing && feed.items.length > 0 && !feed.error) ? (
            <PageFooter {...feed} count={feed.items.length} skeleton="feed" />
          ) : null
        }
        onEndReached={canBrowse ? feed.loadMore : undefined}
        onEndReachedThreshold={0.4}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // Padding inside the header, not the content container, keeps the switch's measured offset in content coordinates.
  header: { paddingTop: Spacing.two },
  tabs: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  emptyFeed: { paddingHorizontal: 20, paddingTop: 16, gap: 4 },
  emptyFeedAction: { paddingHorizontal: 20, paddingTop: 16 },
});
