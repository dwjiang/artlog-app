import { router } from "expo-router";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ButtonGhost, Ghost, LoadingSkeleton } from "@/components/loading-skeleton";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { suggestionReasonText } from "@/lib/social/presentation";
import type { PublicProfile } from "@/lib/social/types";
import type { AvatarId } from "@/shared/social/avatars";

import { ProfileActionRow } from "./friendship-controls";
import { ProfileAvatar } from "./profile-avatar";
import { ProfileBio } from "./profile-bio";
import { socialStyles } from "./social-styles";
import { SuggestionReasonLine } from "./suggested-people";

type ProfileIdentity = {
  name: string;
  subtitle?: string;
  avatarName?: string;
  avatarPhotoUrl?: string;
  avatar?: AvatarId;
  profile?: { photoUrl?: string; avatar: AvatarId; bio?: string };
};
/** A count left undefined is still loading. */
type ProfileStat = { noun: string; count?: number; onPress?: () => void };

const AVATAR_SIZE = 84;
// An icon-only GalleryButton: a 44-point icon frame inside 12-point padding.
const SHARE_WIDTH = 68;

/**
 * Leaving `identity` undefined draws the loading state. The top edge sits at the safe area so the corners line up
 * with navigation bar items: `accessory` takes the top-right corner, and a pushed screen's back button the top-left.
 */
export function ProfileHeader({
  identity,
  stats,
  accessory,
  children,
}: {
  identity?: ProfileIdentity;
  stats: ProfileStat[];
  accessory?: ReactNode;
  children?: ReactNode;
}) {
  const large = useWindowDimensions().fontScale >= 1.6;
  const countsLoading = stats.some((stat) => stat.count === undefined);
  const statRow = (
    <View
      style={{
        alignSelf: "stretch",
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "center",
        columnGap: 36,
        rowGap: 12,
      }}
    >
      {stats.map(({ noun, count, onPress }) => {
        const label = count === 1 ? noun : `${noun}s`;
        const content = (
          <>
            {count === undefined ? <Ghost width={32} height={39} /> : <Text variant="display">{count}</Text>}
            <Text style={socialStyles.caption}>{label}</Text>
          </>
        );
        return onPress && count !== undefined ? (
          <MotionPressable
            key={noun}
            accessibilityRole="button"
            accessibilityLabel={`${count} ${label}`}
            onPress={onPress}
            style={{ alignItems: "center", minWidth: 44, maxWidth: "100%" }}
          >
            {content}
          </MotionPressable>
        ) : (
          <View
            key={noun}
            accessible={count !== undefined}
            accessibilityLabel={count === undefined ? undefined : `${count} ${label}`}
            style={{ alignItems: "center", maxWidth: "100%" }}
          >
            {content}
          </View>
        );
      })}
    </View>
  );
  return (
    <View
      style={{
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 12,
        gap: 12,
        alignItems: "center",
        backgroundColor: Gallery.paper,
      }}
    >
      {accessory && <View style={{ position: "absolute", top: 0, right: 8 }}>{accessory}</View>}
      {identity ? (
        <>
          <ProfileAvatar
            name={identity.profile ? identity.name : identity.avatarName}
            photoUrl={identity.profile ? identity.profile.photoUrl : identity.avatarPhotoUrl}
            avatar={identity.profile ? identity.profile.avatar : identity.avatar}
            size={AVATAR_SIZE}
          />
          <View style={{ alignSelf: "stretch", alignItems: "center", gap: 6 }}>
            <View style={{ alignItems: "center" }}>
              <Text variant={large ? "section" : "display"} accessibilityRole="header" style={{ textAlign: "center" }}>
                {identity.name}
              </Text>
              {identity.subtitle && (
                <Text style={[socialStyles.caption, { textAlign: "center" }]}>{identity.subtitle}</Text>
              )}
            </View>
            {identity.profile
              && (identity.profile.bio ? (
                <ProfileBio text={identity.profile.bio} />
              ) : (
                <Text style={{ fontSize: 16, lineHeight: 24, fontStyle: "italic", color: Gallery.muted }}>No bio</Text>
              ))}
          </View>
        </>
      ) : (
        <LoadingSkeleton label="Opening profile…">
          {/* Margins fill each ghost out to its text's line height, so loading and loaded headers match. */}
          <View style={{ alignItems: "center", gap: 12 }}>
            <Ghost width={AVATAR_SIZE} height={AVATAR_SIZE} round />
            <View style={{ alignItems: "center", gap: 6 }}>
              <View style={{ alignItems: "center" }}>
                <Ghost width={180} height={26} style={{ marginVertical: 6.5 }} />
                <Ghost width={96} height={12} style={{ marginVertical: 3 }} />
              </View>
              <Ghost width={220} height={14} style={{ marginVertical: 5 }} />
            </View>
          </View>
        </LoadingSkeleton>
      )}
      {countsLoading ? (
        <LoadingSkeleton label="Loading counts" style={{ alignSelf: "stretch" }}>
          {statRow}
        </LoadingSkeleton>
      ) : (
        statRow
      )}
      {children && <View style={{ alignSelf: "stretch" }}>{children}</View>}
    </View>
  );
}

/** The friend count while it loads or once the viewer may read it, and no stat where they can't. */
export function friendStat(
  friends: { data?: readonly unknown[] | null; loading: boolean },
  onPress: () => void,
): ProfileStat[] {
  return friends.loading || friends.data ? [{ noun: "friend", count: friends.data?.length, onPress }] : [];
}

/** “Friends with Ana and 2 others” on someone else's profile, led by the first two friends you share. */
export function MutualFriends({ friends, onPress }: { friends: PublicProfile[]; onPress: () => void }) {
  if (friends.length === 0) return null;
  const reason = { kind: "mutual" as const, count: friends.length, friends: friends.slice(0, 2) };
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={suggestionReasonText(reason)}
      onPress={onPress}
      style={{ alignSelf: "center", minHeight: 44, justifyContent: "center" }}
    >
      <SuggestionReasonLine reason={reason} />
    </MotionPressable>
  );
}

export function OwnProfileActions({ profileId }: { profileId: PublicProfile["profileId"] }) {
  return (
    <ProfileActionRow
      actions={[
        <GalleryButton
          key="edit"
          label="Edit profile"
          variant="outlined"
          fullWidth
          onPress={() => router.push("/edit-profile")}
        />,
      ]}
      trailing={<ShareProfileButton profileId={profileId} />}
    />
  );
}

/** The action row while the profile loads: a full-width action beside Share. */
export function ProfileActionsSkeleton() {
  const stacked = useWindowDimensions().fontScale >= 1.5;
  return (
    <LoadingSkeleton label="Loading profile actions…">
      <ProfileActionRow
        actions={[<ButtonGhost key="action" />]}
        trailing={<ButtonGhost width={stacked ? "100%" : SHARE_WIDTH} />}
      />
    </LoadingSkeleton>
  );
}

export function ShareProfileButton({ profileId }: { profileId: PublicProfile["profileId"] }) {
  return (
    <GalleryButton
      label="Share profile"
      icon="square.and.arrow.up"
      iconOnly
      variant="outlined"
      tone="ink"
      onPress={() => router.push({ pathname: "/share-profile", params: { profileId } })}
    />
  );
}
