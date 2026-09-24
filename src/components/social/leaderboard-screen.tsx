import { AppleSignInAction } from "../account/apple-sign-in-action";
import { useAccount } from "@/lib/account/use-account";
import { EmptyState } from "../empty-state";
import { EmptyPodium } from "../empty-state-art";
import { router, Stack } from "expo-router";
import { useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { ThemedText as Text } from "@/components/themed-text";
import { api } from "../../../convex/_generated/api";
import { Gallery } from "@/constants/theme";
import { signInRoute } from "@/lib/account/sign-in-context";
import {
  useLeaderboardChoice,
  type LeaderboardChoice,
} from "@/lib/social/use-leaderboard-choice";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { GalleryButton } from "../collection/gallery-button";
import { NativeSegmentedPicker } from "../collection/native-segmented-picker";
import { ChoiceMenu } from "../choice-menu";
import { LeaderboardParticipation } from "./leaderboard-participation";
import { ProfileAvatar } from "./profile-avatar";
import { SocialGate, SocialState } from "./social-state";
import { ListSkeleton } from "@/components/loading-skeleton";

export function LeaderboardScreen() {
  const session = useSocialSession();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.4;
  const {
    choice,
    changeChoice,
    error: preferenceError,
  } = useLeaderboardChoice();
  const { audience, metric, period } = choice;
  const ready = session.status === "ready";
  const guest =
    session.status === "signed-out" || session.status === "profile-required";
  const canBrowse = ready || (audience === "global" && guest);
  const board = useSocialQuery(
    api.leaderboards.list,
    canBrowse ? choice : "skip",
    session.key,
  );
  const [participationOpen, setParticipationOpen] = useState(false);
  function manageParticipation() {
    if (guest) {
      setParticipationOpen(false);
      router.push(
        session.status === "signed-out"
          ? signInRoute("leaderboards")
          : "/create-profile",
      );
    } else setParticipationOpen(true);
  }
  const rows = board.data?.rows ?? [];
  const visibility = board.data?.visibility ?? "off";
  const unit = metric === "visits" ? "visit" : "artwork";
  const filter = (update: Partial<LeaderboardChoice>) => {
    changeChoice(update);
  };
  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: "", headerLargeTitle: false }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View style={styles.filters}>
            <Text
              variant="pageTitle"
              accessibilityRole="header"
              style={{ marginBottom: 12 }}
            >
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
            {canBrowse && (
              <View
                style={[
                  styles.filterRow,
                  largeText && { flexDirection: "column" },
                ]}
              >
                <ChoiceMenu
                  plain
                  label="Ranking category"
                  value={metric}
                  grow={1.55}
                  onChange={(value) => filter({ metric: value })}
                  options={[
                    { value: "visits", label: "Museum visits" },
                    { value: "artworks", label: "Artworks" },
                  ]}
                />
                <ChoiceMenu
                  plain
                  label="Time period"
                  value={period}
                  onChange={(value) => filter({ period: value })}
                  options={[
                    { value: "month", label: "This month" },
                    { value: "all", label: "All time" },
                  ]}
                />
              </View>
            )}
          </View>
        }
        data={rows}
        keyExtractor={(row) => row.profile.profileId}
        renderItem={({ item, index }) => {
          const own = item.profile.profileId === session.profileId;
          const tied =
            rows[index - 1]?.rank === item.rank
            || rows[index + 1]?.rank === item.rank;
          return (
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
                largeText && { flexWrap: "wrap" },
              ]}
            >
              <Text
                style={[
                  styles.rank,
                  own && styles.ownRank,
                  { minWidth: 25 * fontScale },
                ]}
              >
                {item.rank}
              </Text>
              <ProfileAvatar
                name={item.profile.name}
                photoUrl={item.profile.photoUrl}
                size={36}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name}>
                  {item.profile.name}
                  {own && <Text style={styles.caption}> You</Text>}
                </Text>
              </View>
              <Text style={styles.score}>{item.score}</Text>
            </Pressable>
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
                <GalleryButton
                  label="Browse Global"
                  fullWidth
                  onPress={() => filter({ audience: "global" })}
                />
              </EmptyState>
            ) : (
              <SocialGate session={session} />
            )
          ) : board.loading && !board.error ? (
            <ListSkeleton label="Opening leaderboard…" avatar rows={6} />
          ) : board.error ? (
            <SocialState
              title="Couldn’t load the leaderboard."
              action="Try again"
              onAction={board.refresh}
            />
          ) : board.data ? (
            <EmptyState
              title={
                audience === "friends"
                  ? "No friends on this leaderboard yet."
                  : period === "month"
                    ? "No rankings this month."
                    : "No rankings yet."
              }
              detail={
                audience === "friends"
                  ? "Add friends to see their shared activity totals."
                  : metric === "visits"
                    ? "Log a museum visit to get started."
                    : "Scan an artwork to get started."
              }
              visual={<EmptyPodium />}
            >
              <GalleryButton
                label={
                  audience === "friends"
                    ? "Find friends"
                    : metric === "visits"
                      ? "Add visit"
                      : "Scan artwork"
                }
                variant="filled"
                fullWidth
                onPress={() => {
                  if (audience === "friends") router.push("/people");
                  else if (metric === "visits") router.push("/visit-create");
                  else {
                    router.dismissAll();
                    router.navigate("/scan");
                  }
                }}
              />
              {audience === "friends" && (
                <GalleryButton
                  label="Browse Global"
                  fullWidth
                  onPress={() => filter({ audience: "global" })}
                />
              )}
            </EmptyState>
          ) : null
        }
        ListFooterComponent={
          <View style={styles.explainer}>
            {preferenceError && (
              <Text accessibilityRole="alert" style={styles.caption}>
                {preferenceError}
              </Text>
            )}
            {rows.length > 0 && (
              <Text style={styles.explanation}>
                {metric === "visits"
                  ? "One logged visit per museum, per day."
                  : "Each artwork counts once. Extra photos and encounters don’t add to the total."}
              </Text>
            )}
            {canBrowse && (
              <GalleryButton
                label={
                  visibility === "off"
                    ? "Join the leaderboard"
                    : "Manage participation"
                }
                fullWidth
                onPress={manageParticipation}
              />
            )}
          </View>
        }
      />
      {participationOpen && (
        <LeaderboardParticipation
          onDismiss={() => setParticipationOpen(false)}
        />
      )}
    </View>
  );
}

function LeaderboardSignIn() {
  const account = useAccount();
  return <AppleSignInAction state={account} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Gallery.paper },
  filters: {
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: Gallery.paper,
  },
  filterRow: { flexDirection: "row", gap: 9, marginTop: 13 },
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
    marginVertical: 12,
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
  name: { fontSize: 16, lineHeight: 22, fontWeight: "600", color: Gallery.ink },
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
