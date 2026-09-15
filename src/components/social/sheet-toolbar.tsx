import { Stack, useRouter } from 'expo-router';
import { Gallery } from '@/constants/theme';

export function SheetToolbar() {
  const router = useRouter();
  return <Stack.Toolbar placement="right">
    <Stack.Toolbar.Button onPress={() => router.back()} variant="done" tintColor={Gallery.ink}>Done</Stack.Toolbar.Button>
  </Stack.Toolbar>;
}
