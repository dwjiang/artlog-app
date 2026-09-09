import { Stack } from 'expo-router/stack';

// The router breaks the tie between the three tab index routes for "/" by
// preferring an anchored index; only Scan declares one so it wins.
export const unstable_settings = {
  anchor: 'index',
};

export default function ScanLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Scan', headerShown: false }} />
      <Stack.Screen name="result/[scanId]" options={{ title: 'Result' }} />
      <Stack.Screen name="label/[scanId]" options={{ title: 'Label' }} />
    </Stack>
  );
}
