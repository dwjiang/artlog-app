import { router } from "expo-router";

import { OwnProfileActions, ProfileHeader } from "@/components/social/profile-header";
import { useLocalOwner } from "@/lib/account/owner-store";
import { signInRoute } from "@/lib/account/sign-in-context";
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
  const guest = !useLocalOwner().startsWith("account:");
  const { data: profile, error: profileError } = useSocialQuery(
    api.profiles.mine,
    session.status === "ready" ? {} : "skip",
    session.key,
  );
  const status = profile
    ? `@${profile.username}`
    : guest
      ? "Saved on this iPhone"
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
      stats={[
        { noun: "artwork", count: loading ? undefined : artworkCount },
        { noun: "visit", count: loading ? undefined : visitCount },
      ]}
      accessory={<GalleryIconButton label="Settings" icon="gearshape" onPress={() => router.push("/settings")} />}
    >
      {profile ? (
        <OwnProfileActions profileId={profile.profileId} />
      ) : guest ? (
        artworkCount > 0 && (
          <GalleryButton
            label="Share your wall"
            icon="square.and.arrow.up"
            variant="outlined"
            fullWidth
            onPress={() => router.push(signInRoute("wall"))}
          />
        )
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
