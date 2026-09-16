import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ProfileScreen } from '@/components/social/profile-screen';

export default function ProfileRoute() {
  const { profileId, preview } = useLocalSearchParams<{ profileId: string; preview?: string }>();
  const router = useRouter();
  return <><ProfileScreen profileId={profileId} preview={preview === 'true'} />
    {preview === 'true' && <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button onPress={() => router.back()}>Done</Stack.Toolbar.Button>
    </Stack.Toolbar>}
  </>;
}
