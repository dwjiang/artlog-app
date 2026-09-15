import { Stack } from 'expo-router/stack';

export const unstable_settings = {
  anchor: 'scan',
};

export default function ScanLayout() {
  return (
    <Stack>
      <Stack.Screen name="scan" options={{ title: 'Scan', headerShown: false }} />
      <Stack.Screen name="result/[scanId]" options={{ title: 'Result' }} />
      <Stack.Screen name="label/[scanId]" options={{ title: 'Label' }} />
    </Stack>
  );
}
