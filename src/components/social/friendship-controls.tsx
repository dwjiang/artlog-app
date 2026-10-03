import { Host, Icon, Row, Text as NativeText } from "@expo/ui";
import { Menu, Button, Spacer } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  accessibilityValue,
  buttonStyle,
  contentShape,
  disabled,
  frame,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { router } from "expo-router";
import type { ReactElement, ReactNode } from "react";
import { Alert, StyleSheet, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { TextSkeleton } from "@/components/loading-skeleton";
import { NativeLoadingRing } from "@/components/native-loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { signInRoute } from "@/lib/account/sign-in-context";
import { friendshipActions } from "@/lib/social/presentation";
import type { FriendshipAction, PublicProfile } from "@/lib/social/types";
import { useFriendship, type RelationshipSource } from "@/lib/social/use-friendship";
import type { SocialSession } from "@/lib/social/use-social-session";

import { socialStyles } from "./social-styles";

const labels: Record<FriendshipAction, string> = {
  request: "Add friend",
  accept: "Accept friend",
  decline: "Ignore",
  cancel: "Friend request sent",
  remove: "Remove friend",
};

/**
 * The one-line control for list rows. A row the caller already knows is a friend renders without its own
 * relationship subscription, so the Friends list does not open one query per person.
 */
export function CompactFriendshipControls({
  profileId,
  session,
  friend = false,
  relationship,
  onChanged,
  fullWidth = false,
  declinable = false,
}: {
  onChanged?: () => void;
  profileId: PublicProfile["profileId"];
  session: SocialSession;
  friend?: boolean;
  relationship?: RelationshipSource;
  /** Fills a card's width instead of sitting at the end of a row. */
  fullWidth?: boolean;
  /** Offers Ignore beside Accept on an incoming request. */
  declinable?: boolean;
}) {
  if (profileId === session.profileId) return <Text style={styles.friends}>You</Text>;
  if (friend) return <Text style={styles.friends}>Friends</Text>;
  if (session.status === "signed-out" || session.status === "profile-required") {
    return (
      <GalleryButton
        label="Add"
        variant="outlined"
        fullWidth={fullWidth || undefined}
        onPress={() => router.push(session.status === "signed-out" ? signInRoute("friends") : "/create-profile")}
      />
    );
  }
  if (session.status !== "ready") return null;
  return (
    <CompactFriendshipAction
      profileId={profileId}
      session={session}
      relationship={relationship}
      onChanged={onChanged}
      fullWidth={fullWidth}
      declinable={declinable}
    />
  );
}

function CompactFriendshipAction({
  profileId,
  session,
  relationship,
  onChanged,
  fullWidth,
  declinable,
}: {
  onChanged?: () => void;
  profileId: PublicProfile["profileId"];
  session: SocialSession;
  relationship?: RelationshipSource;
  fullWidth: boolean;
  declinable: boolean;
}) {
  const { state, pending, error, act, refresh } = useFriendship(profileId, session, relationship);
  const busy = pending !== undefined;
  const action =
    state?.state === "pending" ? (state.requesterId === session.profileId ? "cancel" : "accept") : "request";
  const run = (next: FriendshipAction) => {
    void act(next).then((changed) => {
      if (changed) onChanged?.();
    });
  };
  return (
    <View style={fullWidth ? { alignItems: "center" } : { alignItems: "flex-end", maxWidth: 150 }}>
      {state?.state === "accepted" ? (
        <Text style={styles.friends}>Friends</Text>
      ) : (
        <View style={styles.actions}>
          <GalleryButton
            variant={action === "accept" ? "filled" : "outlined"}
            label={action === "accept" ? "Accept" : action === "cancel" ? "Requested" : "Add"}
            icon={action === "cancel" ? "checkmark" : undefined}
            fullWidth={fullWidth || undefined}
            busy={pending === action}
            disabled={busy || !state || state.blocked}
            onPress={() => run(action)}
          />
          {action === "accept" && declinable && (
            <GalleryIconButton
              label="Ignore request"
              icon="xmark"
              tone="muted"
              size={13}
              busy={pending === "decline"}
              disabled={busy}
              onPress={() => run("decline")}
            />
          )}
        </View>
      )}
      {error && <GalleryButton label="Retry" onPress={refresh} />}
    </View>
  );
}

/**
 * One row of profile actions that stacks at large text sizes. `secondary` takes a smaller share than each action,
 * so "Accept friend" stays on one line beside it through XXXL text; `trailing` keeps its own width.
 */
export function ProfileActionRow({
  actions,
  secondary,
  trailing,
}: {
  actions: ReactElement[];
  secondary?: ReactNode;
  trailing?: ReactNode;
}) {
  const stacked = useWindowDimensions().fontScale >= 1.5;
  return (
    <View style={{ flexDirection: stacked ? "column" : "row", gap: Spacing.two }}>
      {actions.map((action) => (
        <View key={action.key} style={stacked ? undefined : { flex: 1 }}>
          {action}
        </View>
      ))}
      {secondary && <View style={stacked ? undefined : { flex: 0.6 }}>{secondary}</View>}
      {trailing}
    </View>
  );
}

function FriendsMenu({ removing, onRemove }: { removing: boolean; onRemove: () => void }) {
  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme="light"
      style={{ width: "100%", borderWidth: 1, borderColor: Gallery.accentBorder, borderRadius: Radius.button }}
    >
      <Menu
        modifiers={[
          accessibilityLabel("Friends"),
          accessibilityValue(removing ? "In progress" : ""),
          buttonStyle("plain"),
          disabled(removing),
        ]}
        label={
          <Row
            alignment="center"
            modifiers={[frame({ maxWidth: Infinity, minHeight: 44 }), contentShape(shapes.rectangle())]}
          >
            {/* Balances the chevron so the label centers on the whole button. */}
            <Spacer modifiers={[frame({ width: 32 })]} />
            <Row spacing={6} alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
              {removing && <NativeLoadingRing label="Removing friend" color={Gallery.ink} />}
              {!removing && <Icon name="checkmark" size={17} color={Gallery.ink} />}
              {!removing && <NativeText textStyle={{ color: Gallery.ink, fontSize: 17 }}>Friends</NativeText>}
            </Row>
            <Icon name="chevron.down" size={12} color={Gallery.ink} modifiers={[frame({ width: 32 })]} />
          </Row>
        }
      >
        <Button label="Remove friend" role="destructive" onPress={onRemove} />
      </Menu>
    </Host>
  );
}

export function FriendshipControls({
  profileId,
  session,
  trailing,
  unblocking = false,
  onUnblock,
}: {
  profileId: PublicProfile["profileId"];
  session: SocialSession;
  trailing?: ReactNode;
  unblocking?: boolean;
  /** Replaces the friendship actions while the viewer blocks this profile. */
  onUnblock: () => void;
}) {
  const { state, pending, error, act, refresh } = useFriendship(profileId, session);
  if (profileId === session.profileId) return null;
  const busy = pending !== undefined;
  const ready = session.status === "ready";
  const actionButton = (action: FriendshipAction) => {
    const primary = action === "request" || action === "accept";
    return (
      <GalleryButton
        key={action}
        label={labels[action]}
        icon={action === "cancel" ? "checkmark" : undefined}
        fullWidth
        minHeight={44}
        busy={pending === action}
        disabled={busy}
        variant={primary ? "filled" : "outlined"}
        tone={primary ? "accent" : "ink"}
        onPress={() => {
          void act(action);
        }}
      />
    );
  };
  const available = ready && state ? friendshipActions(state, session.profileId!) : [];
  const actions =
    session.status === "signed-out" || session.status === "profile-required"
      ? [
          <GalleryButton
            key="add"
            label="Add friend"
            variant="outlined"
            fullWidth
            onPress={() => router.push(session.status === "signed-out" ? signInRoute("friends") : "/create-profile")}
          />,
        ]
      : !ready
        ? []
        : state?.blocked
          ? [
              <GalleryButton
                key="unblock"
                label="Unblock"
                variant="outlined"
                tone="ink"
                fullWidth
                minHeight={44}
                busy={unblocking}
                onPress={onUnblock}
              />,
            ]
          : state?.state === "accepted"
            ? [
                <FriendsMenu
                  key="friends"
                  removing={pending === "remove"}
                  onRemove={() => {
                    if (!busy) {
                      Alert.alert(
                        "Remove this friend?",
                        "You will no longer see each other’s friends-only activity. Public walls remain visible.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Remove friend",
                            style: "destructive",
                            onPress: () => {
                              void act("remove");
                            },
                          },
                        ],
                      );
                    }
                  }}
                />,
              ]
            : state
              ? available.filter((action) => action !== "decline").map(actionButton)
              : error
                ? []
                : [<TextSkeleton key="loading" label="Loading friendship…" width="100%" height={44} />];
  return (
    <View style={{ gap: Spacing.two }}>
      <ProfileActionRow
        actions={actions}
        secondary={available.includes("decline") && actionButton("decline")}
        trailing={trailing}
      />
      {error && (
        <>
          <Text selectable accessibilityRole="alert" style={socialStyles.body}>
            {error}
          </Text>
          <GalleryButton label="Refresh friendship" disabled={busy} onPress={refresh} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  friends: { color: Gallery.muted, fontSize: 13 },
  actions: { flexDirection: "row", alignItems: "center", alignSelf: "stretch", justifyContent: "flex-end" },
});
