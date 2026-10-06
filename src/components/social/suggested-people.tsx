import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { DisplayMedia } from "@/components/artwork/display-media";
import { GalleryButton } from "@/components/collection/gallery-button";
import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { ListSection } from "@/components/list-row";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import { suggestionReasonText } from "@/lib/social/presentation";
import type { BrowsedProfile, Suggestion, SuggestionReason } from "@/lib/social/types";
import type { SocialSession } from "@/lib/social/use-social-session";

import { CompactFriendshipControls } from "./friendship-controls";
import { ProfileAvatar } from "./profile-avatar";
import { ProfileRow } from "./profile-row";

type SuggestionActions = {
  session: SocialSession;
  onDismiss: (person: Suggestion) => void;
  /** Reloads the suggestions, whose rows carry each person's relationship. */
  refresh: () => void;
};
/** A person in the suggestion strip; one shown without a reason, such as a newest profile, can't be dismissed. */
type StripPerson = Suggestion | { profile: BrowsedProfile; reason?: undefined };
const relationshipOf = (person: StripPerson, refresh: () => void) =>
  person.profile.relationship ? { data: person.profile.relationship, refresh } : undefined;

function ReasonVisual({ reason, token, size }: { reason: SuggestionReason; token?: string | null; size: number }) {
  switch (reason.kind) {
    case "mutual":
      return (
        <View style={styles.stack}>
          {reason.friends.map((friend, index) => (
            <View
              key={friend.profileId}
              style={[styles.stacked, { borderRadius: size / 2 + 2 }, index > 0 && { marginLeft: -size / 3 }]}
            >
              <ProfileAvatar name={friend.name} photoUrl={friend.photoUrl} avatar={friend.avatar} size={size} />
            </View>
          ))}
        </View>
      );
    case "artwork":
      return (
        <View style={[styles.thumb, { width: size, height: size }]} accessibilityElementsHidden>
          <DisplayMedia
            media={reason.artwork.artwork.media}
            label={reason.artwork.artwork.title}
            token={token}
            width={size}
            height={size}
            fit="cover"
          />
        </View>
      );
    case "museum":
    case "liked":
      return (
        <Image
          source={reason.kind === "museum" ? "sf:building.columns" : "sf:heart"}
          tintColor={Gallery.muted}
          style={{ width: size * 0.75, height: size * 0.75 }}
          accessible={false}
        />
      );
  }
}

/** One line saying why a person is suggested, led by the mutual friends, artwork or symbol it names. */
export function SuggestionReasonLine({
  reason,
  token,
  centered = false,
}: {
  reason: SuggestionReason;
  token?: string | null;
  centered?: boolean;
}) {
  return (
    <View style={centered ? styles.reasonCentered : styles.reason}>
      <ReasonVisual reason={reason} token={token} size={centered ? 22 : 20} />
      <Text style={[styles.reasonText, centered && { textAlign: "center" }]} numberOfLines={2}>
        {suggestionReasonText(reason)}
      </Text>
    </View>
  );
}

function DismissButton({ person, onDismiss }: { person: Suggestion; onDismiss: (person: Suggestion) => void }) {
  return (
    <GalleryIconButton
      label={`Hide ${person.profile.name} from suggestions`}
      icon="xmark"
      tone="muted"
      size={13}
      onPress={() => onDismiss(person)}
    />
  );
}

function SuggestionRow({
  person,
  session,
  onDismiss,
  refresh,
  first,
  last,
}: SuggestionActions & { person: Suggestion; first: boolean; last: boolean }) {
  return (
    <ProfileRow
      profile={person.profile}
      subtitle={<SuggestionReasonLine reason={person.reason} token={session.token} />}
      first={first}
      last={last}
      trailing={
        <View style={styles.rowActions}>
          <CompactFriendshipControls
            profileId={person.profile.profileId}
            session={session}
            relationship={relationshipOf(person, refresh)}
          />
          <DismissButton person={person} onDismiss={onDismiss} />
        </View>
      }
    />
  );
}

function SuggestionHeading({
  title = "Suggested",
  action,
  tight = false,
}: {
  title?: string;
  action?: { label: string; onPress: () => void };
  /** Directly under other controls, where a full section gap would read as a break. */
  tight?: boolean;
}) {
  return (
    <View style={[styles.heading, tight && { paddingTop: 0 }]}>
      <Text variant="section" accessibilityRole="header">
        {title}
      </Text>
      {action && <GalleryButton label={action.label} variant="text" onPress={action.onPress} />}
    </View>
  );
}

/** The suggestion rows under a “Suggested” heading, for the Friends screen and an empty Friends feed. */
export function SuggestionList({
  people,
  seeAll,
  grouped = false,
  ...actions
}: SuggestionActions & {
  people: Suggestion[];
  seeAll?: () => void;
  /** On a grouped (gray) page the card needs no outline. */
  grouped?: boolean;
}) {
  if (people.length === 0) return null;
  const rows = people.map((person, index) => (
    <SuggestionRow
      key={person.profile.profileId}
      person={person}
      first={index === 0}
      last={index === people.length - 1}
      {...actions}
    />
  ));
  // A section eyebrow has no room for See all, so that case keeps the heading the suggestion strip uses.
  return seeAll ? (
    <View>
      <SuggestionHeading action={{ label: "See all", onPress: seeAll }} />
      <View style={styles.list}>
        <ListSection outlined={!grouped}>{rows}</ListSection>
      </View>
    </View>
  ) : (
    <View style={[styles.list, styles.listTop]}>
      <ListSection title="Suggested" outlined={!grouped}>
        {rows}
      </ListSection>
    </View>
  );
}

function SuggestionCard({
  person,
  session,
  onDismiss,
  refresh,
  width,
}: SuggestionActions & { person: StripPerson; width: number }) {
  const router = useRouter();
  return (
    <View style={[styles.card, { width }]}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={`View ${person.profile.name}’s profile`}
        onPress={() =>
          router.push({ pathname: "/profile/[profileId]", params: { profileId: person.profile.profileId } })
        }
        style={styles.cardIdentity}
      >
        <ProfileAvatar
          name={person.profile.name}
          photoUrl={person.profile.photoUrl}
          avatar={person.profile.avatar}
          size={64}
        />
        <Text style={styles.cardName} numberOfLines={2}>
          {person.profile.name}
        </Text>
        {person.reason ? (
          <SuggestionReasonLine reason={person.reason} token={session.token} centered />
        ) : (
          <Text style={[styles.reasonText, { textAlign: "center" }]} numberOfLines={1}>
            @{person.profile.username}
          </Text>
        )}
      </MotionPressable>
      <CompactFriendshipControls
        profileId={person.profile.profileId}
        session={session}
        relationship={relationshipOf(person, refresh)}
        fullWidth
      />
      {person.reason && (
        <View style={styles.cardDismiss}>
          <DismissButton person={person} onDismiss={onDismiss} />
        </View>
      )}
    </View>
  );
}

function InviteCard({ width }: { width: number }) {
  const router = useRouter();
  return (
    <View style={[styles.card, styles.invite, { width }]}>
      <View style={styles.cardIdentity}>
        <View style={styles.qr}>
          <Image source="sf:qrcode" tintColor={Gallery.accent} style={{ width: 30, height: 30 }} accessible={false} />
        </View>
        <Text style={styles.cardName}>Invite friends</Text>
        <Text style={[styles.reasonText, { textAlign: "center" }]}>Send a link to your profile</Text>
      </View>
      <GalleryButton label="Share" variant="filled" fullWidth onPress={() => router.push("/share-profile")} />
    </View>
  );
}

/** People cards that scroll sideways, as above the Friends feed, ending with an invitation when there is a profile to share. */
export function SuggestionStrip({
  people,
  seeAll,
  title,
  invite = true,
  ...actions
}: SuggestionActions & { people: StripPerson[]; seeAll: () => void; title?: string; invite?: boolean }) {
  const { fontScale } = useWindowDimensions();
  const width = Math.round(168 * Math.min(Math.max(fontScale, 1), 1.5));
  return (
    <View style={styles.strip}>
      <SuggestionHeading title={title} action={{ label: "See all", onPress: seeAll }} tight />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
        {people.map((person) => (
          <SuggestionCard key={person.profile.profileId} person={person} width={width} {...actions} />
        ))}
        {invite && <InviteCard width={width} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    paddingLeft: Spacing.content,
    paddingRight: Spacing.compact,
    paddingTop: Spacing.four,
    minHeight: 44,
  },
  list: { paddingHorizontal: Spacing.content },
  listTop: { paddingTop: Spacing.four },
  // No gap, matching the request rows, whose Ignore button sits flush against Accept.
  rowActions: { flexDirection: "row", alignItems: "center" },
  reason: { flexDirection: "row", alignItems: "center", gap: 6 },
  reasonCentered: { alignItems: "center", gap: 6 },
  reasonText: { ...Typography.metadata, color: Gallery.muted, flexShrink: 1 },
  stack: { flexDirection: "row" },
  stacked: { borderWidth: 1.5, borderColor: Gallery.paper },
  thumb: { borderRadius: Radius.thumbnail, overflow: "hidden" },
  strip: { paddingBottom: Spacing.three },
  cards: { gap: 10, paddingHorizontal: Spacing.content, paddingTop: Spacing.two },
  card: {
    borderWidth: 0.5,
    borderColor: Gallery.separator,
    borderRadius: Radius.card,
    padding: Spacing.compact,
    paddingTop: 18,
    gap: Spacing.compact,
    justifyContent: "space-between",
    backgroundColor: Gallery.surface,
  },
  cardIdentity: { alignItems: "center", gap: 6 },
  cardName: { ...Typography.secondary, fontWeight: "600", color: Gallery.ink, textAlign: "center", marginTop: 6 },
  cardDismiss: { position: "absolute", top: -2, right: -2 },
  invite: { backgroundColor: Gallery.highlight, borderColor: Gallery.accentBorder },
  qr: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: Gallery.paper,
    alignItems: "center",
    justifyContent: "center",
  },
});
