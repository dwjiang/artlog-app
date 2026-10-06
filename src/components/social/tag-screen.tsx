import { Stack } from "expo-router";
import { FlatList, StyleSheet } from "react-native";

import { usePullToRefresh } from "@/components/pull-to-refresh";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing, Typography } from "@/constants/theme";
import type { SharedVisit } from "@/lib/social/types";
import { useBlock } from "@/lib/social/use-block";
import { useCursorPages, useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession, type SocialSession } from "@/lib/social/use-social-session";

import { api } from "../../../convex/_generated/api";
import { PageFooter, SocialGate, SocialState } from "./social-state";
import { socialStyles } from "./social-styles";
import { VisitCard } from "./visit-card";

const feedPage = (result: { page: SharedVisit[]; cursor: string | null; isDone: boolean }) => result;
const visitId = (visit: SharedVisit) => visit.postId;

/** The posts whose notes use one tag, newest visit first, as the same cards as the Home feed. */
export function TagScreen({ tag }: { tag: string }) {
  const session = useSocialSession();
  return <TagFeed key={`${session.key}:${tag}`} tag={tag} session={session} />;
}

function TagFeed({ tag, session }: { tag: string; session: SocialSession }) {
  const blocking = useBlock(session);
  const ready = !session.offline && ["ready", "signed-out", "profile-required"].includes(session.status);
  const summary = useSocialQuery(api.tags.get, ready ? { tag } : "skip", session.key);
  const unavailable = summary.data === null;
  const feed = useCursorPages(
    api.sharedVisits.listByTag,
    ready && !unavailable ? { tag } : "skip",
    session.key,
    feedPage,
    visitId,
  );
  const pull = usePullToRefresh({
    enabled: ready && !unavailable,
    refreshing: feed.refreshing,
    onRefresh: () => {
      summary.refresh();
      feed.refresh();
    },
  });
  const postCount = summary.data?.postCount ?? 0;
  return (
    <>
      <Stack.Screen options={{ title: `#${tag}` }} />
      {/* Each card's comments sheet renders in this tree; "handled" lets taps reach its composer. */}
      <FlatList
        style={socialStyles.root}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[socialStyles.content, { paddingBottom: 28 }]}
        contentInsetAdjustmentBehavior="automatic"
        data={ready && !unavailable ? feed.items : []}
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
          // Friends-only posts can join the list, so the count names what it counts.
          postCount > 0 ? (
            <Text style={styles.count}>
              {postCount} public {postCount === 1 ? "post" : "posts"}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          !ready ? (
            <SocialGate session={session} />
          ) : unavailable ? (
            <SocialState title="Tag unavailable." icon="number" />
          ) : feed.done && !feed.loading && !feed.error ? (
            <SocialState title={`No posts with #${tag} yet.`} icon="number" />
          ) : null
        }
        ListFooterComponent={
          ready && !unavailable && !(feed.refreshing && feed.items.length > 0 && !feed.error) ? (
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
  count: { ...Typography.secondary, color: Gallery.muted, paddingHorizontal: Spacing.content },
});
