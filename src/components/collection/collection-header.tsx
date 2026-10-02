import { router } from "expo-router";

import { OwnProfileActions, ProfileHeader } from "@/components/social/profile-header";
import { useLocalProfile } from "@/lib/account/local-profile";
import { useLocalOwner } from "@/lib/account/owner-store";
import { useSocialQuery } from "@/lib/social/use-social-query";
import { useSocialSession } from "@/lib/social/use-social-session";

import { api } from "../../../convex/_generated/api";
import { GalleryButton } from "./gallery-button";
import { GalleryIconButton } from "./gallery-icon-button";

export function CollectionHeader({
  artworkCount = 0,
  visitCount = 0,
  loading = false,
}: {
  artworkCount?: number;
  visitCount?: number;
  loading?: boolean;
}) {
  const session = useSocialSession();
  const localProfile = useLocalProfile();
  const guest = !useLocalOwner().startsWith("account:");
  const { data: profile, error: profileError } = useSocialQuery(
    api.profiles.mine,
    session.status === "ready" ? {} : "skip",
    session.key,
  );
  const stats = [
    { noun: "artwork", count: loading ? undefined : artworkCount },
    { noun: "visit", count: loading ? undefined : visitCount },
  ];
  const settings = <GalleryIconButton label="Settings" icon="gearshape" onPress={() => router.push("/settings")} />;
  if (guest) {
    return (
      <ProfileHeader
        identity={
          localProfile.loading
            ? undefined
            : {
                name: localProfile.name ?? "Guest",
                avatarName: localProfile.name,
                avatarPhotoUrl: localProfile.photoUrl,
                avatar: localProfile.avatar,
              }
        }
        stats={stats}
        accessory={settings}
      />
    );
  }
  const status = profile
    ? `@${profile.username}`
    : session.status === "offline"
      ? "Offline · saved on this iPhone"
      : session.status === "profile-required"
        ? "Create a profile to share your wall"
        : session.status === "error" || profileError || profile === null
          ? "Profile unavailable"
          : undefined;
  return (
    <ProfileHeader
      identity={
        status === undefined
          ? undefined
          : { name: profile?.name ?? "Your collection", subtitle: status, profile: profile ?? undefined }
      }
      stats={stats}
      accessory={settings}
    >
      {profile ? (
        <OwnProfileActions profileId={profile.profileId} />
      ) : (
        session.status === "profile-required" && (
          <GalleryButton
            label="Create profile"
            variant="filled"
            fullWidth
            onPress={() => router.push("/create-profile")}
          />
        )
      )}
    </ProfileHeader>
  );
}
