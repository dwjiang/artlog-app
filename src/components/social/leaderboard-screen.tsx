import { router, Stack } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions, type FlatList } from "react-native";
import Animated, { useAnimatedRef, type CSSAnimationProperties } from "react-native-reanimated";

import { SignInActions } from "@/components/account/sign-in-actions";
import { ActionStack } from "@/components/action-stack";
import { ChoiceMenu } from "@/components/choice-menu";
import { GalleryButton } from "@/components/collection/gallery-button";
import { NativeSegmentedPicker } from "@/components/collection/native-segmented-picker";
import { EmptyState } from "@/components/empty-state";
import { EmptyPodium } from "@/components/empty-state-art";
import { Ghost, LoadingSkeleton } from "@/components/loading-skeleton";
import { usePullToRefresh } from "@/components/pull-to-refresh";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { signInRoute } from "@/lib/account/sign-in-context";
import { useAccount } from "@/lib/account/use-account";
import { useLeaderboardChoice, type LeaderboardChoice } from "@/lib/social/use-leaderboard-choice";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";

import { api } from "../../../convex/_generated/api";
import { LeaderboardParticipation } from "./leaderboard-participation";
import { ProfileAvatar } from "./profile-avatar";
import { SocialGate, SocialState } from "./social-state";

// FlatList never unmounts its first `initialNumToRender` rows, so only a newly loaded board fades in, not rows
// that mount later while scrolling.
const REVEALED_ROWS = 15;
// `satisfies` keeps the literal type: the widened CSSAnimationProperties passes or fails Animated.View's style check
// depending on the order TypeScript happens to evaluate the program in.
const reveal = {
  animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
  animationDuration: 250,
  animationTimingFunction: "ease-out",
} satisfies CSSAnimationProperties;

export function LeaderboardScreen() {
  const session = useSocialSession();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.4;
  const { choice, changeChoice, error: preferenceError } = useLeaderboardChoice();
  const { audience, metric } = choice;
  const ready = session.status === "ready";
  const guest = session.status === "signed-out" || session.status === "profile-required";
  const canBrowse = ready || (audience === "global" && guest);
  const board = useSocialQuery(api.leaderboards.list, canBrowse ? choice : "skip", session.key);
  const participation = useSocialQuery(api.leaderboards.preference, ready ? {} : "skip", session.key);
  const [participationOpen, setParticipationOpen] = useState(false);
  function manageParticipation() {
    if (guest) {
      setParticipationOpen(false);
      router.push(session.status === "signed-out" ? signInRoute("leaderboards") : "/create-profile");
    } else {
      setParticipationOpen(true);
    }
  }
  const rows = board.data?.rows ?? [];
  const list = useAnimatedRef<FlatList<(typeof rows)[number]>>();
  const pull = usePullToRefresh(list, {
    enabled: canBrowse,
    refreshing: board.refreshing,
    onRefresh: board.refresh,
  });
  const visibility = participation.data ?? "off";
  const unit = metric === "visits" ? "visit" : "artwork";
  const filter = (update: Partial<LeaderboardChoice>) => {
    changeChoice(update);
  };
  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: "", headerLargeTitle: false }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="person.2.badge.gearshape"
          accessibilityLabel={visibility === "off" ? "Join the leaderboard" : "Manage participation"}
          tintColor={Gallery.ink}
          hidesSharedBackground
          hidden={!ready && !guest}
          onPress={manageParticipation}
        />
      </Stack.Toolbar>
      <Animated.FlatList
        ref={list}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 24 }}
        initialNumToRender={REVEALED_ROWS}
        refreshControl={pull.refreshControl}
        ListHeaderComponent={
          <Animated.View style={[styles.filters, pull.headerStyle]} onLayout={pull.onHeaderLayout}>
            <Text variant="pageTitle" accessibilityRole="header" style={{ marginBottom: 12 }}>
              Leaderboards
            </Text>
            <NativeSegmentedPicker
              label="Leaderboard audience"
              value={audience}
              onChange={(value) => filter({ audience: value })}
              options={[
                { value: "friends", label: "Friends" },
                { value: "global", label: "Global" },
              ]}
            />
            <View style={styles.filterRow}>
              <ChoiceMenu
                label="Rank by"
                value={metric}
                onChange={(value) => filter({ metric: value })}
                options={[
                  { value: "visits", label: "Museum visits" },
                  { value: "artworks", label: "Artworks" },
                ]}
              />
            </View>
          </Animated.View>
        }
        data={rows}
        keyExtractor={(row) => row.profile.profileId}
        renderItem={({ item, index }) => {
          const own = item.profile.profileId === session.profileId;
          const aboveOwn = rows[index + 1]?.profile.profileId === session.profileId;
          const tied = rows[index - 1]?.rank === item.rank || rows[index + 1]?.rank === item.rank;
          return (
            <Animated.View style={index < REVEALED_ROWS && reveal}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${tied ? "Tied rank" : "Rank"} ${item.rank}, ${item.profile.name}${own ? ", you" : ""}, ${item.score} ${unit}${item.score === 1 ? "" : "s"}. Open public profile.`}
                onPress={() =>
                  router.push({
                    pathname: "/profile/[profileId]",
                    params: { profileId: item.profile.profileId },
                  })
                }
                style={[
                  styles.row,
                  own && styles.ownRow,
                  aboveOwn && { borderBottomWidth: 0 },
                  largeText && { flexWrap: "wrap" },
                ]}
              >
                <Text style={[styles.rank, own && styles.ownRank, { minWidth: 25 * fontScale }]}>{item.rank}</Text>
                <ProfileAvatar name={item.profile.name} photoUrl={item.profile.photoUrl} size={36} />
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{item.profile.name}</Text>
                  {own && <Text style={[styles.caption, { fontWeight: "600" }]}>You</Text>}
                </View>
                <Text style={styles.score}>{item.score}</Text>
              </Pressable>
            </Animated.View>
          );
        }}
        ListEmptyComponent={
          !canBrowse ? (
            guest ? (
              <EmptyState
                title={
                  session.status === "signed-out"
                    ? "Sign in to see friends’ rankings."
                    : "Create a profile to see friends’ rankings."
                }
                detail="Rankings show saved artwork and visit totals. You can browse Global without a profile."
                visual={<EmptyPodium />}
              >
                <ActionStack
                  textActions={
                    <GalleryButton label="Browse Global" fullWidth onPress={() => filter({ audience: "global" })} />
                  }
                >
                  {session.status === "signed-out" ? (
                    <LeaderboardSignIn />
                  ) : (
                    <GalleryButton
                      label="Create your profile"
                      variant="filled"
                      fullWidth
                      onPress={() => router.push("/create-profile")}
                    />
                  )}
                </ActionStack>
              </EmptyState>
            ) : (
              <SocialGate session={session} />
            )
          ) : board.error ? (
            <SocialState title="Couldn’t load the leaderboard." action="Try again" onAction={board.refresh} centered />
          ) : !board.data ? (
            <LeaderboardSkeleton />
          ) : (
            <EmptyState
              title={audience === "friends" ? "No friends on this leaderboard yet." : "No rankings yet."}
              detail={
                audience === "friends"
                  ? "Add friends to see their shared activity totals."
                  : metric === "visits"
                    ? "Log a museum visit to get started."
                    : "Scan an artwork to get started."
              }
              visual={<EmptyPodium />}
            >
              <ActionStack
                textActions={
                  audience === "friends" && (
                    <GalleryButton label="Browse Global" fullWidth onPress={() => filter({ audience: "global" })} />
                  )
                }
              >
                <GalleryButton
                  label={audience === "friends" ? "Find friends" : metric === "visits" ? "Add visit" : "Scan artwork"}
                  variant="filled"
                  fullWidth
                  onPress={() => {
                    if (audience === "friends") {
                      router.push("/people");
                    } else if (metric === "visits") {
                      router.push("/visit-add");
                    } else {
                      router.dismissAll();
                      router.navigate("/scan");
                    }
                  }}
                />
              </ActionStack>
            </EmptyState>
          )
        }
        ListFooterComponent={
          <View style={styles.explainer}>
            {preferenceError && (
              <Text accessibilityRole="alert" style={styles.caption}>
                {preferenceError}
              </Text>
            )}
            {rows.length > 0 && metric === "artworks" && (
              <Animated.View style={reveal}>
                <Text style={styles.explanation}>
                  Each artwork counts once. Extra photos and encounters don’t add to the total.
                </Text>
              </Animated.View>
            )}
          </View>
        }
      />
      {participationOpen && <LeaderboardParticipation onDismiss={() => setParticipationOpen(false)} />}
    </View>
  );
}

function LeaderboardSkeleton() {
  const { fontScale } = useWindowDimensions();
  return (
    <LoadingSkeleton label="Opening leaderboard…">
      {Array.from({ length: 6 }, (_, index) => (
        <View key={index} style={styles.row}>
          <View style={{ minWidth: 25 * fontScale }}>
            <Ghost width={12} />
          </View>
          <Ghost width={36} height={36} round />
          <View style={{ flex: 1 }}>
            <Ghost width={index % 2 ? "44%" : "58%"} height={16} />
          </View>
          <Ghost width={24} height={19} />
        </View>
      ))}
    </LoadingSkeleton>
  );
}

function LeaderboardSignIn() {
  const account = useAccount();
  return <SignInActions state={account} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  filters: {
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: Gallery.paper,
  },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two, marginTop: Spacing.two },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 60,
    paddingVertical: 7,
    marginHorizontal: 18,
    borderBottomWidth: 0.5,
    borderBottomColor: Gallery.separator,
  },
  // Extend the highlight around the shared content column.
  ownRow: {
    backgroundColor: Gallery.highlight,
    borderRadius: 2,
    marginHorizontal: 6,
    paddingHorizontal: 12,
    borderBottomWidth: 0,
  },
  rank: {
    minWidth: 25,
    fontSize: 14,
    color: Gallery.muted,
    fontVariant: ["tabular-nums"],
  },
  ownRank: {
    color: Gallery.surface,
    backgroundColor: Gallery.ink,
    textAlign: "center",
    paddingVertical: 4,
  },
  nameRow: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: Spacing.two },
  name: { flexShrink: 1, fontSize: 16, lineHeight: 22, fontWeight: "600", color: Gallery.ink },
  score: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "600",
    color: Gallery.ink,
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.5,
  },
  explainer: { paddingHorizontal: 20, paddingTop: 10, gap: 0 },
  explanation: { color: Gallery.muted, fontSize: 13, lineHeight: 18 },
});
