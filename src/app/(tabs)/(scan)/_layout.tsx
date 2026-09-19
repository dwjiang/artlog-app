import { Stack } from 'expo-router/stack';
import { NavigationTheme } from '@/constants/theme';

export const unstable_settings = {
  anchor: 'scan',
};

export default function ScanLayout() {
  return (
    <Stack screenOptions={NavigationTheme}>
      <Stack.Screen name="scan" options={{ title: 'Scan', headerShown: false }} />
    </Stack>
  );
}
