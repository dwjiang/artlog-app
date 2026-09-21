import { GalleryBackToolbar } from '@/components/gallery-back-toolbar';
import { useLocalSearchParams } from 'expo-router';
import { ProfileScreen } from '@/components/social/profile-screen';

export default function ProfileRoute() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  return <><GalleryBackToolbar /><ProfileScreen profileId={profileId} /></>;
}
