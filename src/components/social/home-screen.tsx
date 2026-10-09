import { useLocalSearchParams, useRouter } from "expo-router";
import { use, useRef, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";

import { WelcomePrompt } from "@/components/account/welcome-prompt";
import { GalleryButton } from "@/components/collection/gallery-button";
import { EmptyCard } from "@/components/empty-state";
import { FeedSkeleton } from "@/components/loading-skeleton";
import { usePaneRoom, usePaneSwitch } from "@/components/pane-scroll";
import { usePullToRefresh } from "@/components/pull-to-refresh";
import { ThemedText as Text } from "@/components/themed-text";
import { NowCard, useNowCardScroll } from "@/components/visits/now-card";
import { VisitlessSavesCard } from "@/components/visits/visitless-saves-card";
import { WrapUpPrompt } from "@/components/visits/wrap-up-prompt";
import { Spacing } from "@/constants/theme";
import { signInRoute } from "@/lib/account/sign-in-context";
import type { SharedVisit } from "@/lib/social/types";
import { UnseenNotificationCount } from "@/lib/social/unseen-notifications";
import { useBlock } from "@/lib/social/use-block";
import { useCursorPages, useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { useSuggestions } from "@/lib/social/use-suggestions";
import { useVenue } from "@/lib/venue/use-venue";

import { api } from "../../../convex/_generated/api";
import { AvatarStack } from "./avatar-stack";
import { HomeToolbar, type Feed } from "./home-toolbar";
import { SocialInvitation } from "./social-invitation";
import { PageFooter, SocialGate } from "./social-state";
import { socialStyles } from "./social-styles";
import { SuggestionList, SuggestionStrip } from "./suggested-people";
import { VisitCard } from "./visit-card";
import { VisitSeparator } from "./visit-separator";

// Suggestions sit above the Friends feed only until there are enough friends for the feed to carry the screen.
const STRIP_FRIEND_LIMIT = 5;
const feedPage = (result: { page: SharedVisit[]; cursor: string | null; isDone: boolean }) => result;
const visitId = (visit: SharedVisit) => visit.postId;
const INVITATION_FACES = (["vermeer", "sunflowers", "klee"] as const).map((avatar) => ({ profileId: avatar, avatar }));

export function HomeScreen() {
  const [dismissedPrompt, setDismissedPrompt] = useState(false);
  const [chosenTab, setChosenTab] = useState<Feed>();
  // Posting a visit returns here naming the feed it landed in; each post carries its own stamp so a repeat lands too.
  const { feed: requestedFeed, posted } = useLocalSearchParams<{ feed?: string; posted?: string }>();
  const [appliedPost, setAppliedPost] = useState<string>();
  const request = posted && (requestedFeed === "friends" || requestedFeed === "global") ? posted : undefined;
  if (request && request !== appliedPost) {
    setAppliedPost(request);
    setChosenTab(requestedFeed as Feed);
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
  const [landing, setLanding] = useState<{ profileId: typeof session.profileId; tab: Feed }>();
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
  const { onCardLayout, onScroll: onNowCardScroll } = useNowCardScroll();
  // During a visit the Now card leads Home, so an empty feed sits beneath it as a card instead of filling the page.
  const card = !!useVenue().visit;
  const shareProfile = () => router.push("/share-profile");
  const pull = usePullToRefresh({
    enabled: canBrowse,
    refreshing: feed.refreshing,
    onRefresh: feed.refresh,
  });
  return (
    <>
      {/* Guests see these too; each page asks them to sign in. */}
      <HomeToolbar requests={requests} unseen={unseen} feed={tab} onFeedChange={setChosenTab} />
      <WelcomePrompt />
      <WrapUpPrompt />
      {/* Each card's comments sheet renders in this tree; "handled" lets taps reach its composer. */}
      <FlatList
        ref={list}
        keyboardShouldPersistTaps="handled"
        style={socialStyles.root}
        contentContainerStyle={[socialStyles.content, { paddingBottom: 28, minHeight: room.minHeight }]}
        contentInsetAdjustmentBehavior="automatic"
        onLayout={room.onLayout}
        onScroll={(event) => {
          room.onScroll(event);
          onNowCardScroll(event);
        }}
        data={canBrowse ? feed.items : []}
        keyExtractor={visitId}
        ItemSeparatorComponent={VisitSeparator}
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
              <View style={styles.invitation}>
                <EmptyCard
                  title="Add your friends."
                  detail="Sign in to see the museum visits and artworks they share."
                  visual={<AvatarStack people={INVITATION_FACES} size={40} />}
                  action={{ label: "Sign in", onPress: () => router.push(signInRoute("friends")) }}
                  secondaryAction={{ label: "Not now", onPress: () => setDismissedPrompt(true) }}
                />
              </View>
            )}
            <NowCard onLayout={onCardLayout} />
            <VisitlessSavesCard />
            {/* Each feed starts here; the suggestion strip below belongs to Friends. */}
            <View onLayout={room.onPinnedLayout} />
            {showStrip && <SuggestionStrip people={suggestions.people} {...suggestionActions} />}
          </>
        }
        ListEmptyComponent={
          !canBrowse ? (
            session.status === "loading" ? (
              <FeedSkeleton label="Loading your account…" />
            ) : (
              <SocialGate session={session} onBrowseGlobal={() => setChosenTab("global")} card={card} />
            )
          ) : feed.done && !feed.loading && !feed.error ? (
            tab === "global" ? (
              <SocialInvitation
                card={card}
                title="No public visits yet."
                detail="View public walls to see other people’s collections."
                action={{ label: "View public walls", onPress: () => router.push("/people") }}
                secondaryAction={{ label: "Scan an artwork", onPress: () => router.navigate("/scan") }}
              />
            ) : suggestions.people.length > 0 ? (
              card ? (
                <View>
                  <EmptyCard
                    title="No visits from friends yet."
                    detail="Add friends to see the museum visits they share."
                    action={{ label: "Share your profile", icon: "qrcode", onPress: shareProfile }}
                  />
                  <SuggestionList people={suggestions.people.slice(0, 5)} {...suggestionActions} />
                </View>
              ) : (
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
                      onPress={shareProfile}
                    />
                  </View>
                </View>
              )
            ) : (
              <SocialInvitation
                card={card}
                title="No visits from friends yet."
                detail="Add friends to see the museum visits they share."
                action={{ label: "Find friends", onPress: () => router.push("/people") }}
                secondaryAction={{ label: "Browse Global", onPress: () => setChosenTab("global") }}
              />
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
  // Padding inside the header, not the content container, keeps measured offsets in content coordinates.
  header: { paddingTop: Spacing.two },
  invitation: { paddingBottom: Spacing.three },
  emptyFeed: { paddingHorizontal: 20, paddingTop: 16, gap: 4 },
  emptyFeedAction: { paddingHorizontal: 20, paddingTop: 16 },
});
