import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, SectionList, StyleSheet, View } from "react-native";

import { DisplayMedia } from "@/components/artwork/display-media";
import { GalleryButton } from "@/components/collection/gallery-button";
import { ListSkeleton } from "@/components/loading-skeleton";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import { reportError } from "@/lib/observability";
import { notificationAge } from "@/lib/social/presentation";
import { useCursorPages } from "@/lib/social/use-social-query";
import { useSocialSession, type SocialSession } from "@/lib/social/use-social-session";
import { groupNotifications, notificationSentence } from "@/shared/social/notifications";

import { api } from "../../../convex/_generated/api";
import { CompactFriendshipControls } from "./friendship-controls";
import { ProfileAvatar } from "./profile-avatar";
import { SocialInvitation } from "./social-invitation";
import { PageFooter, SocialGate } from "./social-state";
import { socialStyles } from "./social-styles";
import { profileHref, TextLink } from "./tagged-text";

type NotificationPage = FunctionReturnType<typeof api.notifications.list>;
type Item = NotificationPage["page"][number];
const notificationPage = (result: NotificationPage) => result;
const notificationId = (item: Item) => item.id;
type Media = NonNullable<Extract<Item, { kind: "visitLike" }>["media"]>;

const LEAD = 44;

export function NotificationsScreen() {
  const session = useSocialSession();
  const router = useRouter();
  const focused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);
  const ready = session.status === "ready";
  const list = useCursorPages(
    api.notifications.list,
    ready ? {} : "skip",
    session.key,
    notificationPage,
    notificationId,
  );
  const markSeen = useMutation(api.notifications.markSeen);
  const [now, setNow] = useState(Date.now);
  useFocusEffect(
    useCallback(() => {
      if (appState !== "active") return;
      setNow(Date.now());
      const timer = setInterval(() => setNow(Date.now()), 60_000);
      return () => clearInterval(timer);
    }, [appState]),
  );
  // "New" keeps what was unseen when the page opened, so marking it seen doesn't empty the section being read.
  const [opened, setOpened] = useState<{ key: string; seenAt: number }>();
  if (list.first && opened?.key !== session.key) setOpened({ key: session.key, seenAt: list.first.seenAt });
  const boundary = opened?.seenAt ?? 0;
  const { items, canLoadMore, loadMore } = list;
  useEffect(() => {
    if (ready && focused && appState === "active" && items.length === 0 && canLoadMore) loadMore();
  }, [ready, focused, appState, items.length, canLoadMore, loadMore]);
  const newest = items[0]?.createdAt ?? 0;
  const unseen = !!list.first && newest > list.first.seenAt;
  useEffect(() => {
    if (ready && focused && appState === "active" && unseen) {
      markSeen({ through: newest }).catch((cause: unknown) => reportError(cause, "notifications.markSeen"));
    }
  }, [ready, focused, appState, unseen, newest, markSeen]);
  const sections = [
    { title: "New", data: groupNotifications(items.filter((item) => item.createdAt > boundary)) },
    { title: "Earlier", data: groupNotifications(items.filter((item) => item.createdAt <= boundary)) },
  ].filter((section) => section.data.length > 0);
  const empty = !ready || sections.length === 0;
  return (
    <SectionList
      style={socialStyles.root}
      contentContainerStyle={[socialStyles.content, empty && { paddingBottom: 0 }]}
      contentInsetAdjustmentBehavior="automatic"
      bounces={!empty}
      sections={ready ? sections : []}
      keyExtractor={(row) => row[0].id}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => (
        <Text
          variant="section"
          accessibilityRole="header"
          style={[styles.section, section === sections[0] && { paddingTop: Spacing.two }]}
        >
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <NotificationRow row={item} session={session} now={now} onRelationshipChanged={list.refresh} />
      )}
      ItemSeparatorComponent={Separator}
      ListEmptyComponent={
        !ready ? (
          <SocialGate session={session} />
        ) : list.done ? (
          <SocialInvitation
            title="No notifications yet."
            detail="Friend requests, likes and comments on your visits, mentions, and visits you’re added to appear here."
          >
            <GalleryButton label="Find friends" variant="filled" fullWidth onPress={() => router.push("/people")} />
          </SocialInvitation>
        ) : null
      }
      ListFooterComponent={
        ready && !list.done ? (
          items.length === 0 && !list.error ? (
            <ListSkeleton label="Loading notifications…" avatar />
          ) : (
            <PageFooter {...list} count={items.length} noun="notifications" />
          )
        ) : null
      }
      onEndReached={ready ? loadMore : undefined}
      onEndReachedThreshold={0.4}
    />
  );
}

function sentence(row: Item[]) {
  const [first] = row;
  const { actor } = first;
  switch (first.kind) {
    case "friendRequest":
      return notificationSentence({ kind: first.kind, actor, accepted: first.relationship.state === "accepted" });
    case "friendAccepted":
      return notificationSentence({ kind: first.kind, actor });
    case "visitLike":
      return notificationSentence({
        kind: first.kind,
        people: row.map((item) => item.actor),
        count: row.length,
        venue: first.venue,
      });
    case "visitComment":
    case "visitCompanion":
    case "visitMention":
      return notificationSentence({ kind: first.kind, actor, venue: first.venue });
    case "commentMention":
      return notificationSentence({ kind: first.kind, actor, owner: first.owner, venue: first.venue });
  }
}

function NotificationRow({
  row,
  session,
  now,
  onRelationshipChanged,
}: {
  row: Item[];
  session: SocialSession;
  now: number;
  onRelationshipChanged: () => void;
}) {
  const router = useRouter();
  const [first] = row;
  const age = notificationAge(first.createdAt, now);
  const segments = sentence(row);
  const quote =
    first.kind === "visitComment" || first.kind === "visitMention" || first.kind === "commentMention"
      ? `“${first.body}”`
      : undefined;
  const profiles = new Map(row.map(({ actor }) => [actor.profileId, actor]));
  if (first.kind === "commentMention") profiles.set(first.owner.profileId, first.owner);
  const people = [...profiles.values()].filter(({ profileId }) =>
    segments.some((segment) => segment.profileId === profileId),
  );
  const open = () => {
    if (first.kind === "friendRequest" || first.kind === "friendAccepted") {
      router.push(profileHref(first.actor.profileId));
    } else {
      const comments = first.kind === "visitComment" || first.kind === "commentMention";
      router.push({
        pathname: "/visit/[postId]",
        params: comments ? { postId: first.postId, comments: "1" } : { postId: first.postId },
      });
    }
  };
  const time = (
    <Text style={styles.time} accessible={false}>
      {age.short}
    </Text>
  );
  return (
    <View style={styles.row}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={[segments.map((segment) => segment.text).join(""), quote, age.spoken]
          .filter(Boolean)
          .join(" ")}
        // VoiceOver reads the row as one element, so each name's link is also one of its actions.
        accessibilityActions={people.map(({ name, username, profileId }) => ({
          name: profileId,
          label: `View ${name}’s profile (@${username})`,
        }))}
        onAccessibilityAction={({ nativeEvent }) => router.push(profileHref(nativeEvent.actionName))}
        onPress={open}
        // A quoted comment runs several lines, so its row hangs from the top instead of centering on the avatar.
        style={[styles.main, !quote && { alignItems: "center" }]}
      >
        <MotionPressable accessible={false} onPress={() => router.push(profileHref(first.actor.profileId))}>
          {row.length > 1 ? (
            <AvatarPair people={[row[0].actor, row[1].actor]} />
          ) : (
            <ProfileAvatar
              name={first.actor.name}
              photoUrl={first.actor.photoUrl}
              avatar={first.actor.avatar}
              size={LEAD}
            />
          )}
        </MotionPressable>
        <View style={styles.body}>
          <Text style={styles.text}>
            {segments.map(({ text, profileId }, index) =>
              profileId ? (
                <TextLink key={index} href={profileHref(profileId)} style={styles.bold}>
                  {text}
                </TextLink>
              ) : (
                text
              ),
            )}
            {!quote && <> {time}</>}
          </Text>
          {quote && (
            <>
              <Text style={styles.text} numberOfLines={2}>
                {quote}
              </Text>
              {time}
            </>
          )}
        </View>
        {"venue" in first && <VisitThumbnail media={first.media} label={first.venue} token={session.token} />}
      </MotionPressable>
      {first.kind === "friendRequest" && first.relationship.state === "pending" && (
        <View style={styles.controls}>
          <CompactFriendshipControls
            declinable
            profileId={first.actor.profileId}
            session={session}
            relationship={{ data: first.relationship, refresh: onRelationshipChanged }}
          />
        </View>
      )}
    </View>
  );
}

// The newest person leads; the next one sits small at the corner so initials stay readable without photos.
function AvatarPair({ people: [lead, next] }: { people: Item["actor"][] }) {
  return (
    <View style={styles.pair}>
      <ProfileAvatar name={lead.name} photoUrl={lead.photoUrl} avatar={lead.avatar} size={32} />
      <View style={styles.pairNext}>
        <ProfileAvatar name={next.name} photoUrl={next.photoUrl} avatar={next.avatar} size={22} />
      </View>
    </View>
  );
}

// A square crop of the visit's first artwork, like the feed's first slot; artwork without media shows the fill.
function VisitThumbnail({ media, label, token }: { media?: Media; label: string; token?: string | null }) {
  const ratio = media && media.width > 0 && media.height > 0 ? media.width / media.height : 1;
  return (
    <View style={styles.thumbnail}>
      {media && media.kind !== "placeholder" && (
        <DisplayMedia
          media={media}
          label={label}
          token={token}
          width={ratio >= 1 ? LEAD * ratio : LEAD}
          height={ratio >= 1 ? LEAD : LEAD / ratio}
        />
      )}
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: Spacing.content, paddingTop: Spacing.four, paddingBottom: Spacing.one },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    paddingLeft: Spacing.content,
    paddingRight: Spacing.content,
    paddingVertical: Spacing.compact,
  },
  main: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: Spacing.compact },
  body: { flex: 1, gap: Spacing.half },
  text: { ...Typography.secondary, color: Gallery.ink },
  bold: { fontWeight: "600" },
  time: { ...Typography.secondary, color: Gallery.muted },
  controls: { marginRight: -Spacing.two },
  pair: { width: LEAD, height: LEAD },
  pairNext: {
    position: "absolute",
    right: -2,
    bottom: -2,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: Gallery.paper,
  },
  thumbnail: {
    width: LEAD,
    height: LEAD,
    borderRadius: Radius.thumbnail,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Gallery.fill,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.content + LEAD + Spacing.compact,
    backgroundColor: Gallery.separator,
  },
});
