import { Stack } from 'expo-router/stack';

export const unstable_settings = {
  anchor: 'collection',
};

export default function CollectionLayout() {
  return (
    <Stack>
      <Stack.Screen name="collection" options={{ title: 'Collection', headerLargeTitleEnabled: true }} />
      <Stack.Screen name="[savedId]" options={{ title: 'Saved work' }} />
    </Stack>
  );
}
