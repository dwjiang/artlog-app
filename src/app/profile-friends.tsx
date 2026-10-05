import { useLocalSearchParams } from "expo-router";

import { ProfileFriendsScreen } from "@/components/social/profile-friends-screen";

export default function ProfileFriendsRoute() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  return <ProfileFriendsScreen profileId={profileId} />;
}
