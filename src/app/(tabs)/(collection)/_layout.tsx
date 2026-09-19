import { Stack } from 'expo-router/stack';
import { NavigationTheme } from '@/constants/theme';

export const unstable_settings = {
  anchor: 'collection',
};

export default function CollectionLayout() {
  return (
    <Stack screenOptions={NavigationTheme}>
      <Stack.Screen name="collection" options={{ title: 'Collection', headerShown: false }} />
      <Stack.Screen name="visit-place" options={{ title: 'Visits by museum' }} />
    </Stack>
  );
}
