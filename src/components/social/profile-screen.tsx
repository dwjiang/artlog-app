import { Stack, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useRef, useState } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NativeSegmentedPicker } from "@/components/collection/native-segmented-picker";
import { EmptyState } from "@/components/empty-state";
import { VisitAudienceFilter, type VisitAudienceFilterValue } from "@/components/visits/visit-visibility-picker";
import { Gallery } from "@/constants/theme";
import type { SharedVisit } from "@/lib/social/types";
import { useCursorPages, useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import type { VisitVisibility } from "@/shared/journal/contracts";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { FriendshipControls } from "./friendship-controls";
import { OwnProfileActions, ProfileHeader, ShareProfileButton } from "./profile-header";
import { PublicWallView } from "./public-wall-view";
import { ReportToolbar } from "./report-toolbar";
import { PageFooter, SocialGate, SocialState } from "./social-state";
import { socialStyles } from "./social-styles";
import { VisitCard } from "./visit-card";

const visitPage = (page: { page: SharedVisit[]; cursor: string | null; isDone: boolean }) => page;
const visitId = (visit: SharedVisit) => visit.postId;
const FILTERED_EMPTY: Record<VisitVisibility, string> = {
  private: "No private visits.",
  friends: "No friends-only visits.",
  public: "No public visits.",
};

export function ProfileScreen({ profileId }: { profileId: string }) {
  const session = useSocialSession();
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const { top } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const [tab, setTab] = useState<"wall" | "visits">("wall");
  const [chosenAudience, setAudience] = useState<VisitAudienceFilterValue>("all");
  const [visitCount, setVisitCount] = useState<number>();
  const scroll = useRef<ScrollView>(null);
  const offsets = useRef({ wall: 0, visits: 0 });
  const args = profileId && !session.offline ? { profileId: profileId as Id<"profiles"> } : "skip";
  const profile = useSocialQuery(api.profiles.getPublic, args, session.key);
  const wall = useSocialQuery(api.walls.getPublic, profile.data ? args : "skip", session.key);
  const own = session.profileId === profileId;
  const relationship = useSocialQuery(
    api.friendships.getState,
    session.status === "ready" && !own ? args : "skip",
    session.key,
  );
  const canReadVisits = !session.offline && !!profile.data && !relationship.data?.blocked;
  const audiences: VisitVisibility[] = own
    ? ["private", "friends", "public"]
    : relationship.data?.state === "accepted"
      ? ["friends", "public"]
      : [];
  // Ending a friendship removes the Friends choice, so a stale choice falls back to every visit.
  const audience = chosenAudience === "all" || audiences.includes(chosenAudience) ? chosenAudience : "all";
  const visits = useCursorPages(
    api.sharedVisits.listByProfile,
    canReadVisits ? { profileId: profileId as Id<"profiles">, ...(audience === "all" ? {} : { audience }) } : "skip",
    session.key,
    visitPage,
    visitId,
  );
  // The header counts every visit the viewer can see, so it keeps the last full count while a filter is on.
  if (audience === "all" && visits.done && visits.items.length !== visitCount) setVisitCount(visits.items.length);
  function changeTab(value: "wall" | "visits") {
    setTab(value);
    requestAnimationFrame(() => scroll.current?.scrollTo({ y: offsets.current[value], animated: false }));
  }
  if (session.offline) return <SocialGate session={session} />;
  if (!profileId || profile.data === null) {
    return (
      <SocialState
        action="Back to Home"
        onAction={() => {
          router.dismissAll();
          router.navigate("/");
        }}
        title="Profile unavailable."
        detail="This public profile is no longer available."
      />
    );
  }
  if (profile.error) {
    return (
      <SocialState
        title="Couldn’t load this profile."
        detail={socialErrorMessage(profile.error) ?? "Please try again."}
        action="Try again"
        onAction={profile.refresh}
      />
    );
  }
  // The transparent bar lets the photo rise level with the back button. Past about 115% text, the longest back
  // label ("Leaderboards") reaches the photo, so the header stays below the bar.
  const bar = (
    <Stack.Screen options={{ title: "", headerTransparent: true, headerStyle: { backgroundColor: "transparent" } }} />
  );
  const pulledToSafeArea = { marginTop: fontScale < 1.15 ? top - headerHeight : 0 };
  if (!profile.data) {
    return (
      <>
        {bar}
        <ScrollView style={socialStyles.root} contentInsetAdjustmentBehavior="automatic">
          <View style={pulledToSafeArea}>
            <ProfileHeader stats={[{ noun: "artwork" }, { noun: "visit" }]} />
          </View>
        </ScrollView>
      </>
    );
  }
  const person = profile.data;
  return (
    <GestureHandlerRootView style={socialStyles.root}>
      {bar}
      {session.status !== "loading" && session.profileId !== profileId && (
        <ReportToolbar kind="profile" id={person.profileId} />
      )}
      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        stickyHeaderIndices={[1]}
        scrollEventThrottle={100}
        onScroll={(event) => {
          offsets.current[tab] = event.nativeEvent.contentOffset.y;
        }}
        contentContainerStyle={{ paddingBottom: 30 }}
      >
        <View style={pulledToSafeArea}>
          <ProfileHeader
            identity={{ name: person.name, subtitle: `@${person.username}`, profile: person }}
            stats={[
              { noun: "artwork", count: person.publishedWallCount },
              ...(visitCount !== undefined ? [{ noun: "visit", count: visitCount }] : []),
            ]}
          >
            {own ? (
              <OwnProfileActions profileId={person.profileId} />
            ) : (
              <FriendshipControls
                key={`${session.key}:${profileId}`}
                profileId={person.profileId}
                session={session}
                trailing={<ShareProfileButton profileId={person.profileId} />}
              />
            )}
          </ProfileHeader>
        </View>
        {/* Sticky headers pin to the scroll view's top edge, which sits under the transparent bar. A see-through
            spacer the bar's height pins Wall/Visits just below it. box-none keeps the header's buttons under the spacer
            tappable, and must be a style: the sticky wrapper takes this View's style but not its props. */}
        <View style={{ pointerEvents: "box-none", marginTop: -headerHeight, paddingTop: headerHeight }}>
          <View
            style={{
              backgroundColor: Gallery.paper,
              paddingHorizontal: 20,
              paddingBottom: 12,
              paddingTop: 4,
            }}
          >
            <NativeSegmentedPicker
              label="Profile section"
              value={tab}
              onChange={changeTab}
              options={[
                { value: "wall", label: "Wall" },
                { value: "visits", label: "Visits" },
              ]}
            />
          </View>
        </View>
        {tab === "wall" ? (
          wall.error ? (
            <SocialState title="Couldn’t load this wall." action="Try again" onAction={wall.refresh} />
          ) : wall.data ? (
            <PublicWallView
              wall={wall.data}
              arrangedBy={person.name.split(" ")[0]}
              onSelect={(item) =>
                router.push({
                  pathname: "/artwork",
                  params: { kind: "wall", itemId: item.itemId },
                })
              }
            />
          ) : (
            <SocialState title="Opening wall…" loading />
          )
        ) : !canReadVisits ? (
          <SocialState
            title="Visits aren’t available here."
            detail="Shared visits aren’t available for this profile."
            icon="lock"
          />
        ) : (
          <View>
            {audiences.length > 0 && !(audience === "all" && visits.done && visits.items.length === 0) && (
              <View
                style={{ paddingHorizontal: 20, paddingVertical: 6, flexDirection: "row", justifyContent: "flex-end" }}
              >
                <VisitAudienceFilter value={audience} choices={audiences} onChange={setAudience} />
              </View>
            )}
            {visits.items.map((visit) => (
              <VisitCard key={visit.postId} visit={visit} token={session.token} viewerProfileId={session.profileId} />
            ))}
            {visits.done
              && !visits.loading
              && visits.items.length === 0
              && !visits.error
              && (audience === "all" ? (
                <EmptyState
                  title="No shared visits yet."
                  detail={`When ${person.name.split(" ")[0]} shares a museum visit, it will appear here.`}
                />
              ) : (
                <EmptyState title={FILTERED_EMPTY[audience]} />
              ))}
            <PageFooter {...visits} count={visits.items.length} />
          </View>
        )}
      </ScrollView>
    </GestureHandlerRootView>
  );
}
