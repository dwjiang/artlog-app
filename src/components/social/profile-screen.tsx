import { Stack, useRouter } from "expo-router";
import { useHeaderHeight, useIsFocused } from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { Fragment, useState } from "react";
import { ScrollView, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NativeSegmentedPicker } from "@/components/collection/native-segmented-picker";
import { EmptyState } from "@/components/empty-state";
import { FeedSkeleton, WallSkeleton } from "@/components/loading-skeleton";
import { usePaneRoom, usePaneSwitch } from "@/components/pane-scroll";
import { usePullToRefresh } from "@/components/pull-to-refresh";
import { VisitAudienceFilter, type VisitAudienceFilterValue } from "@/components/visits/visit-visibility-picker";
import { Gallery } from "@/constants/theme";
import { useScrollTitle } from "@/hooks/use-scroll-title";
import { isIOS26OrLater } from "@/lib/ios-version";
import type { SharedVisit } from "@/lib/social/types";
import { useBlock } from "@/lib/social/use-block";
import { isMutualFriend, useFriends } from "@/lib/social/use-friends";
import { useCursorPages, useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";
import { isLightWall } from "@/lib/wall/wall-layout";
import type { VisitVisibility } from "@/shared/journal/contracts";
import { socialErrorMessage } from "@/shared/social/errors";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { FriendshipControls } from "./friendship-controls";
import { InCommonSection } from "./in-common";
import { friendStat, MutualFriends, ProfileActionsSkeleton, ProfileHeader } from "./profile-header";
import { PublicWallView } from "./public-wall-view";
import { ReportToolbar } from "./report-toolbar";
import { PageFooter, SocialGate, SocialState, StateScreen } from "./social-state";
import { socialStyles } from "./social-styles";
import { VisitCard } from "./visit-card";
import { VisitSeparator } from "./visit-separator";
import { useWallBehindBar } from "./wall-behind-bar";

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
  const [tab, setTab] = useState<"wall" | "visits">("wall");
  const [chosenAudience, setAudience] = useState<VisitAudienceFilterValue>("all");
  const [visitCount, setVisitCount] = useState<number>();
  const args = profileId && !session.offline ? { profileId: profileId as Id<"profiles"> } : "skip";
  const profile = useSocialQuery(api.profiles.getPublic, args, session.key);
  const own = session.profileId === profileId;
  const relationship = useSocialQuery(
    api.friendships.getState,
    session.status === "ready" && !own ? args : "skip",
    session.key,
  );
  const blocked = relationship.data?.blocked === true;
  const friends = useFriends(session, profileId ? (profileId as Id<"profiles">) : undefined);
  const openFriends = () =>
    own
      ? router.push({ pathname: "/people", params: { filter: "friends" } })
      : router.push({ pathname: "/profile-friends", params: { profileId } });
  const blocking = useBlock(session);
  const wall = useSocialQuery(api.walls.getPublic, profile.data && !blocked ? args : "skip", session.key);
  const behindBar = useWallBehindBar();
  const shownWall = tab === "wall" && !blocked && wall.data?.items.length ? wall.data : undefined;
  // iOS 26 bars are clear over the content, so over a dark wall their title and status bar take its light ink; older
  // bars blur to a light material and keep ink.
  const darkWall = !!shownWall && isIOS26OrLater() && !isLightWall(shownWall.color);
  const {
    scrollRef,
    headingRef,
    measureHeading,
    onScroll: onTitleScroll,
  } = useScrollTitle(profile.data?.name ?? "", darkWall && behindBar.title ? Gallery.paper : Gallery.ink);
  const focused = useIsFocused();
  const canReadVisits = !session.offline && !!profile.data && !blocked;
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
  const room = usePaneRoom(scrollRef, {
    empty:
      blocked
      || (tab === "wall"
        ? !!wall.error || wall.data?.items.length === 0
        : !canReadVisits || (visits.done && visits.items.length === 0)),
  });
  usePaneSwitch(tab, () => room);
  // The header rises under the bar into the spinner's place, so the spinner rises with it to stay clear of the photo.
  const raisedBy = isIOS26OrLater() ? headerHeight - top : 0;
  const pull = usePullToRefresh({
    enabled: !!profile.data,
    progressViewOffset: -raisedBy,
    refreshing: profile.refreshing || (tab === "wall" ? wall.refreshing : visits.refreshing),
    onRefresh: () => {
      profile.refresh();
      relationship.refresh();
      friends.refresh();
      if (tab === "wall") wall.refresh();
      else visits.refresh();
    },
  });
  // The header counts every visit the viewer can see, so it keeps the last full count while a filter is on.
  if (audience === "all" && visits.done && visits.items.length !== visitCount) setVisitCount(visits.items.length);
  if (session.offline) {
    return (
      <StateScreen>
        <SocialGate session={session} />
      </StateScreen>
    );
  }
  if (!profileId || profile.data === null || profile.error) {
    return (
      <StateScreen>
        {!profileId || profile.data === null ? (
          <SocialState
            action="Back to Home"
            onAction={() => {
              router.dismissAll();
              router.navigate("/");
            }}
            title="Profile unavailable."
            detail="This public profile is no longer available."
          />
        ) : (
          <SocialState
            title="Couldn’t load this profile."
            detail={socialErrorMessage(profile.error) ?? "Please try again."}
            action="Try again"
            onAction={profile.refresh}
          />
        )}
      </StateScreen>
    );
  }
  // The photo fits between iOS 26 bar items; older bars blur their full width, so the photo stays below them.
  const pulledToSafeArea = { marginTop: -raisedBy };
  // Until the profile arrives, the same layout draws ghosts in place of the header, actions, and the open section.
  const person = profile.data;
  const unblock = () => {
    if (person && relationship.data) blocking.unblock(person, relationship.data.blockRevision);
  };
  // Unrequested pages don't keep the header loading while pagination is idle.
  const countingVisits = !person || (canReadVisits && audience === "all" && visits.loading && !visits.error);
  return (
    <GestureHandlerRootView style={socialStyles.root}>
      {focused && darkWall && behindBar.status && <StatusBar style="light" />}
      {own && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="square.and.arrow.up"
            accessibilityLabel="Share Profile"
            tintColor={Gallery.ink}
            onPress={() => router.push({ pathname: "/share-profile", params: { profileId } })}
          />
          <Stack.Toolbar.Spacer width={8} />
          <Stack.Toolbar.Button tintColor={Gallery.ink} onPress={() => router.push("/edit-profile")}>
            Edit
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      {person && session.status !== "loading" && !own && (
        <ReportToolbar
          kind="profile"
          id={person.profileId}
          leading={
            <Stack.Toolbar.MenuAction
              icon="square.and.arrow.up"
              onPress={() => router.push({ pathname: "/share-profile", params: { profileId: person.profileId } })}
            >
              Share Profile…
            </Stack.Toolbar.MenuAction>
          }
        >
          {session.status === "ready" && relationship.data && (
            <Stack.Toolbar.MenuAction
              icon="hand.raised"
              destructive={!blocked}
              disabled={blocking.pending !== undefined}
              onPress={() => (blocked ? unblock() : blocking.block(person))}
            >
              {blocked ? "Unblock…" : "Block…"}
            </Stack.Toolbar.MenuAction>
          )}
        </ReportToolbar>
      )}
      {/* Each card's comments sheet renders in this tree; "handled" lets taps reach its composer. */}
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        bounces={!room.empty || !!pull.refreshControl}
        refreshControl={pull.refreshControl}
        onLayout={room.onLayout}
        onContentSizeChange={measureHeading}
        onScroll={(event) => {
          room.onScroll(event);
          onTitleScroll(event);
          behindBar.onScroll(event);
        }}
        contentContainerStyle={{ paddingBottom: room.empty ? 0 : 30, minHeight: room.minHeight }}
      >
        <View style={pulledToSafeArea}>
          <ProfileHeader
            identity={person && { name: person.name, subtitle: `@${person.username}`, profile: person }}
            stats={[
              { noun: "artwork", count: person?.publishedWallCount },
              ...(visitCount !== undefined || countingVisits ? [{ noun: "visit", count: visitCount }] : []),
              ...friendStat(friends, openFriends),
            ]}
            headingRef={headingRef}
            onHeadingLayout={measureHeading}
          >
            {!own
              && (person ? (
                <>
                  <MutualFriends friends={friends.data?.filter(isMutualFriend) ?? []} onPress={openFriends} />
                  <FriendshipControls
                    key={`${session.key}:${profileId}`}
                    profileId={person.profileId}
                    session={session}
                    unblocking={blocking.pending === person.profileId}
                    onUnblock={unblock}
                  />
                </>
              ) : (
                <ProfileActionsSkeleton />
              ))}
          </ProfileHeader>
          {person && !own && !blocked && <InCommonSection profileId={person.profileId} session={session} />}
        </View>
        {blocked && person && <SocialState title={`You blocked ${person.name}.`} icon="hand.raised" />}
        {/* The scroll view's top edge sits under the transparent bar, so a see-through spacer the bar's height puts the
            pane switch's pinned point where Wall/Visits meet the bar. box-none keeps the header's buttons under the
            spacer tappable. */}
        {!blocked && (
          <View
            style={{ pointerEvents: "box-none", marginTop: -headerHeight, paddingTop: headerHeight }}
            onLayout={room.onPinnedLayout}
          >
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
                onChange={setTab}
                options={[
                  { value: "wall", label: "Wall" },
                  { value: "visits", label: "Visits" },
                ]}
              />
            </View>
          </View>
        )}
        {blocked ? null : tab === "wall" ? (
          wall.error ? (
            <SocialState title="Couldn’t load this wall." action="Try again" onAction={wall.refresh} />
          ) : wall.data && person ? (
            <View onLayout={behindBar.onWallLayout}>
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
            </View>
          ) : (
            <WallSkeleton />
          )
        ) : !person ? (
          <FeedSkeleton />
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
            {visits.items.map((visit, index) => (
              <Fragment key={visit.postId}>
                {index > 0 && <VisitSeparator />}
                <VisitCard
                  visit={visit}
                  token={session.token}
                  viewerProfileId={session.profileId}
                  onBlock={session.status === "ready" ? blocking.block : undefined}
                />
              </Fragment>
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
            <PageFooter {...visits} count={visits.items.length} skeleton="feed" />
          </View>
        )}
      </ScrollView>
    </GestureHandlerRootView>
  );
}
