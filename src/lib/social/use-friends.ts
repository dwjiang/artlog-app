import { useLocalOwner } from "@/lib/account/owner-store";

import { api } from "../../../convex/_generated/api";
import type { BrowsedProfile, PublicProfile } from "./types";
import { useSocialQuery } from "./use-social-query";
import type { SocialSession } from "./use-social-session";

/**
 * `data` is null when the viewer can't see this person's friends; guests and people without a profile skip the query.
 * A signed-in session that is still resolving counts as loading, so a friend count can hold its place from launch.
 */
export function useFriends(session: SocialSession, profileId: PublicProfile["profileId"] | undefined) {
  const signedIn = useLocalOwner().startsWith("account:");
  const friends = useSocialQuery(
    api.profiles.friends,
    session.status === "ready" && profileId ? { profileId } : "skip",
    session.key,
  );
  return { ...friends, loading: friends.loading || (signedIn && session.status === "loading") };
}

/** On someone else's friend list, the people the viewer is also friends with. */
export const isMutualFriend = (person: BrowsedProfile) => person.relationship?.state === "accepted";
