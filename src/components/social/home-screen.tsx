import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View, useWindowDimensions, type FlatList } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
import { Gallery } from "@/constants/theme";
import { signInRoute } from "@/lib/account/sign-in-context";
import type { SharedVisit } from "@/lib/social/types";
import { useBlock } from "@/lib/social/use-block";
import { useCursorPages, useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { useSuggestions } from "@/lib/social/use-suggestions";

import { api } from "../../../convex/_generated/api";
import { NotificationsButton } from "./notifications-button";
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
  const { fontScale } = useWindowDimensions();
  const session = useSocialSession();
  const blocking = useBlock(session);
  const guest = session.status === "signed-out";
  const tab =
    chosenTab ?? (session.status === "ready" ? "friends" : session.status === "loading" ? undefined : "global");
  // Friends needs a profile; Global is open to guests and to accounts that have not created one yet.
  const canBrowseFriends = session.status === "ready";
  const canBrowseGlobal = canBrowseFriends || guest || session.status === "profile-required";
  const canBrowse = tab === "global" ? canBrowseGlobal : canBrowseFriends;
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
  const feed = tab === "global" ? globalFeed : friendsFeed;
  const router = useRouter();
  const requests = useSocialQuery(api.profiles.requests, canBrowseFriends ? {} : "skip", session.key);
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
  const list = useAnimatedRef<FlatList<SharedVisit>>();
  const room = usePaneRoom(list);
  usePaneSwitch(tab ?? "", () => room);
  const pull = usePullToRefresh(list, {
    enabled: canBrowse,
    refreshing: feed.refreshing,
    onRefresh: feed.refresh,
    restInset: useSafeAreaInsets().top,
  });
  return (
    <>
      <WelcomePrompt />
      <WrapUpPrompt />
      <Animated.FlatList
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
        ListHeaderComponent={
          <Animated.View style={pull.headerStyle} onLayout={pull.onHeaderLayout}>
            <View style={[styles.masthead, fontScale > 1.4 && styles.mastheadLarge]}>
              <Text variant={fontScale > 1.4 ? "display" : "wordmark"} accessibilityRole="header">
                Artlog
              </Text>
              <View style={styles.headerActions}>
                <GalleryIconButton icon="trophy" label="Leaderboards" onPress={() => router.push("/leaderboards")} />
                <FriendsButton requests={requests.data?.length ?? 0} onPress={() => router.push("/people")} />
                <NotificationsButton session={session} />
              </View>
            </View>
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
          </Animated.View>
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

function FriendsButton({ requests, onPress }: { requests: number; onPress: () => void }) {
  return (
    <View>
      <GalleryIconButton
        icon="person.badge.plus"
        label={requests > 0 ? `Find friends, ${requests} ${requests === 1 ? "request" : "requests"}` : "Find friends"}
        onPress={onPress}
      />
      {requests > 0 && (
        <View style={styles.badge}>
          <Text allowFontScaling={false} style={styles.badgeText}>
            {requests > 9 ? "9+" : requests}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  masthead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  mastheadLarge: { flexDirection: "column", alignItems: "flex-start" },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-end",
    paddingBottom: 12,
  },
  tabs: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  badge: {
    position: "absolute",
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: Gallery.accent,
    borderWidth: 2,
    borderColor: Gallery.paper,
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  badgeText: { color: Gallery.paper, fontSize: 11, lineHeight: 13, fontWeight: "600" },
  emptyFeed: { paddingHorizontal: 20, paddingTop: 16, gap: 4 },
  emptyFeedAction: { paddingHorizontal: 20, paddingTop: 16 },
});
