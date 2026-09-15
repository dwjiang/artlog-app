import { Stack } from 'expo-router/stack';
import { Gallery } from '@/constants/theme';

export const unstable_settings = {
  anchor: 'collection',
};

export default function CollectionLayout() {
  return (
    <Stack screenOptions={{ headerTintColor: Gallery.ink, headerStyle: { backgroundColor: Gallery.paper },
      contentStyle: { backgroundColor: Gallery.paper }, headerShadowVisible: false,
      headerTitleStyle: { color: Gallery.ink }, headerLargeTitleStyle: { color: Gallery.ink } }}>
      <Stack.Screen name="collection" options={{ title: 'Collection', headerLargeTitleEnabled: true }} />
      <Stack.Screen name="[savedId]" options={{ title: 'Saved work' }} />
    </Stack>
  );
}
