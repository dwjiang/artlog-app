import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View, useWindowDimensions } from "react-native";

import { WelcomePrompt } from "@/components/account/welcome-prompt";
import { GalleryButton } from "@/components/collection/gallery-button";
import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { NativeSegmentedPicker } from "@/components/collection/native-segmented-picker";
import { LoadingRing } from "@/components/loading-ring";
import { FeedSkeleton } from "@/components/loading-skeleton";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { signInRoute } from "@/lib/account/sign-in-context";
import type { SharedVisit } from "@/lib/social/types";
import { useCursorPages } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";

import { api } from "../../../convex/_generated/api";
import { SocialInvitation } from "./social-invitation";
import { PageFooter, SocialGate } from "./social-state";
import { socialStyles } from "./social-styles";
import { VisitCard } from "./visit-card";

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
  return (
    <>
      <WelcomePrompt />
      <FlatList
        style={socialStyles.root}
        contentContainerStyle={[socialStyles.content, { paddingBottom: 28 }]}
        contentInsetAdjustmentBehavior="automatic"
        data={canBrowse ? feed.items : []}
        keyExtractor={visitId}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        renderItem={({ item }) => <VisitCard visit={item} token={session.token} viewerProfileId={session.profileId} />}
        refreshControl={
          canBrowse ? (
            <RefreshControl refreshing={feed.refreshing} tintColor="transparent" onRefresh={feed.refresh} />
          ) : undefined
        }
        ListHeaderComponent={
          <>
            <View style={[styles.masthead, fontScale > 1.4 && styles.mastheadLarge]}>
              <Text variant={fontScale > 1.4 ? "display" : "wordmark"} accessibilityRole="header">
                Artlog
              </Text>
              <View style={styles.headerActions}>
                {feed.refreshing && <LoadingRing accessibilityLabel="Refreshing visits" />}
                <GalleryIconButton icon="trophy" label="Leaderboards" onPress={() => router.push("/leaderboards")} />
                <GalleryIconButton icon="magnifyingglass" label="Find friends" onPress={() => router.push("/people")} />
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
            <View style={styles.tabs}>
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
                <GalleryButton
                  label="View public walls"
                  variant="filled"
                  fullWidth
                  onPress={() => router.push("/people")}
                />
                <GalleryButton label="Scan an artwork" fullWidth onPress={() => router.navigate("/scan")} />
              </SocialInvitation>
            ) : (
              <SocialInvitation
                title="No visits from friends yet."
                detail="Add friends to see the museum visits they share."
              >
                <GalleryButton label="Find friends" variant="filled" fullWidth onPress={() => router.push("/people")} />
                <GalleryButton label="Browse Global" fullWidth onPress={() => setChosenTab("global")} />
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
});
