import { router } from "expo-router";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { Ghost, LoadingSkeleton } from "@/components/loading-skeleton";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import type { PublicProfile } from "@/lib/social/types";

import { ProfileActionRow } from "./friendship-controls";
import { ProfileAvatar } from "./profile-avatar";
import { ProfileBio } from "./profile-bio";
import { socialStyles } from "./social-styles";

type ProfileIdentity = {
  name: string;
  subtitle?: string;
  avatarName?: string;
  profile?: { photoUrl?: string; bio?: string };
};
/** A count left undefined is still loading. */
type ProfileStat = { noun: string; count?: number };

const AVATAR_SIZE = 84;

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
    <View style={{ flexDirection: "row", justifyContent: "center", gap: 36 }}>
      {stats.map(({ noun, count }) => {
        const label = count === 1 ? noun : `${noun}s`;
        return (
          <View
            key={noun}
            accessible={count !== undefined}
            accessibilityLabel={count === undefined ? undefined : `${count} ${label}`}
            style={{ alignItems: "center" }}
          >
            {count === undefined ? <Ghost width={32} height={38} /> : <Text variant="display">{count}</Text>}
            <Text style={socialStyles.caption}>{label}</Text>
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
            photoUrl={identity.profile?.photoUrl}
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
          <View style={{ alignItems: "center", gap: 12 }}>
            <Ghost width={AVATAR_SIZE} height={AVATAR_SIZE} round />
            <View style={{ alignItems: "center", gap: 8 }}>
              <Ghost width={180} height={30} />
              <Ghost width={110} />
            </View>
          </View>
        </LoadingSkeleton>
      )}
      {countsLoading ? <LoadingSkeleton label="Loading counts">{statRow}</LoadingSkeleton> : statRow}
      {children && <View style={{ alignSelf: "stretch" }}>{children}</View>}
    </View>
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
