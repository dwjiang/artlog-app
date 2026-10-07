import { useRouter } from "expo-router";
import type { ReactNode } from "react";

import { ListRow } from "@/components/list-row";
import type { PublicProfile } from "@/lib/social/types";

import { ProfileAvatar } from "./profile-avatar";
import { profileHref } from "./tagged-text";

/** A person in a grouped list. Tapping the row opens their profile unless it is not `interactive`. */
export function ProfileRow({
  profile,
  subtitle,
  query,
  trailing,
  first,
  last,
  interactive = true,
  onOpen,
}: {
  profile: PublicProfile;
  /** Replaces the @username line, for example with why a person is suggested. */
  subtitle?: ReactNode;
  query?: string;
  trailing?: ReactNode;
  first: boolean;
  last: boolean;
  interactive?: boolean;
  /** Runs before the profile opens, for a native sheet that has to close first. */
  onOpen?: () => void;
}) {
  const router = useRouter();
  return (
    <ListRow
      title={profile.name}
      query={query}
      subtitle={subtitle ?? `@${profile.username}`}
      leading={<ProfileAvatar name={profile.name} photoUrl={profile.photoUrl} avatar={profile.avatar} size={40} />}
      trailing={trailing}
      first={first}
      last={last}
      accessibilityLabel={`View ${profile.name}’s profile`}
      onPress={
        interactive
          ? () => {
              onOpen?.();
              router.push(profileHref(profile.profileId));
            }
          : undefined
      }
    />
  );
}
