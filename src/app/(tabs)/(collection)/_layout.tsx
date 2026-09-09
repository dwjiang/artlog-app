import { Stack } from 'expo-router/stack';

export default function CollectionLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Collection', headerLargeTitleEnabled: true }} />
      <Stack.Screen name="[savedId]" options={{ title: 'Saved work' }} />
    </Stack>
  );
}
