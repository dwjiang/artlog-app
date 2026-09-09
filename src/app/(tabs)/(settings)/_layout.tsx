import { Stack } from 'expo-router/stack';

export default function SettingsLayout() {
  return (
    <Stack>
      <Stack.Screen name="settings" options={{ title: 'Settings', headerLargeTitleEnabled: true }} />
    </Stack>
  );
}
