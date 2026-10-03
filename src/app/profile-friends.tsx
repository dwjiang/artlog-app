import { useLocalSearchParams } from "expo-router";

import { GalleryBackToolbar } from "@/components/gallery-back-toolbar";
import { ProfileFriendsScreen } from "@/components/social/profile-friends-screen";

export default function ProfileFriendsRoute() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  return (
    <>
      <GalleryBackToolbar />
      <ProfileFriendsScreen profileId={profileId} />
    </>
  );
}
