import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View, useWindowDimensions } from "react-native";

import { WelcomePrompt } from "@/components/account/welcome-prompt";
import { useListeningDockInset } from "@/components/audio/use-listening-dock-inset";
import { GalleryButton } from "@/components/collection/gallery-button";
import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { LoadingRing } from "@/components/loading-ring";
import { FeedSkeleton, Ghost } from "@/components/loading-skeleton";
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

export function HomeScreen() {
  const [dismissedPrompt, setDismissedPrompt] = useState(false);
  const dockInset = useListeningDockInset();
  const { fontScale } = useWindowDimensions();
  const session = useSocialSession();
  const guest = session.status === "signed-out";
  const ready = session.status === "ready" || guest;
  const feed = useCursorPages(
    guest ? api.sharedVisits.listPublic : api.sharedVisits.listFeed,
    ready ? {} : "skip",
    session.key,
    feedPage,
    visitId,
  );
  const router = useRouter();
  return (
    <>
      <WelcomePrompt />
      <FlatList
        style={socialStyles.root}
        contentContainerStyle={[socialStyles.content, { paddingBottom: 28 + dockInset }]}
        contentInsetAdjustmentBehavior="automatic"
        data={ready ? feed.items : []}
        keyExtractor={visitId}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        renderItem={({ item }) => <VisitCard visit={item} token={session.token} />}
        refreshControl={
          ready ? (
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
                <GalleryIconButton icon="trophy" label="Leaderboards" onPress={() => router.push("/leaderboards")} />
                <GalleryIconButton icon="magnifyingglass" label="Find friends" onPress={() => router.push("/people")} />
                <GalleryIconButton
                  icon="person.2"
                  label="Friends"
                  onPress={() =>
                    router.push({
                      pathname: "/people",
                      params: { filter: "friends" },
                    })
                  }
                />
              </View>
            </View>
            {guest && !dismissedPrompt && (
              <View
                style={{
                  marginHorizontal: 20,
                  marginBottom: 16,
                  paddingLeft: 12,
                  paddingVertical: 6,
                  backgroundColor: "#EEF2FF",
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
            {(ready || session.status === "loading") && (
              <View style={styles.heading}>
                {ready ? (
                  <Text variant="section" accessibilityRole="header" style={styles.eyebrow}>
                    {guest ? "Public visits" : "Recent visits"}
                  </Text>
                ) : (
                  <Ghost width={110} height={24} />
                )}
                {feed.refreshing && <LoadingRing accessibilityLabel="Refreshing visits" />}
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          !ready ? (
            session.status === "loading" ? (
              <FeedSkeleton label="Loading your account…" />
            ) : (
              <SocialGate session={session} browsePublic />
            )
          ) : feed.done && !feed.loading && !feed.error ? (
            <SocialInvitation
              title={guest ? "No public visits yet." : "No visits from friends yet."}
              detail={
                guest
                  ? "View public walls to see other people’s collections."
                  : "Add friends to see the museum visits they share."
              }
            >
              <GalleryButton
                label={guest ? "View public walls" : "Find friends"}
                variant="filled"
                fullWidth
                onPress={() => router.push("/people")}
              />
              <GalleryButton label="Scan an artwork" fullWidth onPress={() => router.navigate("/scan")} />
            </SocialInvitation>
          ) : null
        }
        ListFooterComponent={
          ready && !(feed.refreshing && feed.items.length > 0 && !feed.error) ? (
            <PageFooter {...feed} count={feed.items.length} skeleton="feed" />
          ) : null
        }
        onEndReached={ready ? feed.loadMore : undefined}
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
    gap: 8,
    alignSelf: "flex-end",
    paddingBottom: 12,
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 6,
  },
  eyebrow: {
    backgroundColor: Gallery.highlight,
    paddingHorizontal: 6,
    paddingVertical: 3,
    color: Gallery.ink,
  },
});
