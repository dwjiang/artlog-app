import { Stack, useRouter } from 'expo-router';
import { ShareProfileScreen } from '@/components/social/share-profile-screen';

export default function Route() {
  const router = useRouter();
  return <><ShareProfileScreen /><Stack.Toolbar placement="right">
    <Stack.Toolbar.Button onPress={() => router.back()}>Done</Stack.Toolbar.Button>
  </Stack.Toolbar></>;
}
