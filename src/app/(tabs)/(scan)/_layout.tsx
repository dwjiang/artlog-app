import { Stack } from 'expo-router/stack';
import { NavigationTheme } from '@/constants/theme';

export const unstable_settings = {
  anchor: 'scan',
};

export default function ScanLayout() {
  return (
    <Stack screenOptions={NavigationTheme}>
      <Stack.Screen name="scan" options={{ title: 'Scan', headerShown: false }} />
      <Stack.Screen name="result/[scanId]"
        options={({ route }) => ({ title: 'Result', animation: (route.params as { entrance?: string } | undefined)?.entrance === 'capture' ? 'fade' : 'default' })}
        listeners={({ navigation, route }) => ({
          transitionEnd: ({ data }) => {
            if (!data.closing && (route.params as { entrance?: string } | undefined)?.entrance === 'capture') {
              navigation.setParams({ entrance: undefined });
            }
          },
        })}
      />
      <Stack.Screen name="label/[scanId]" options={{ title: 'Label' }} />
    </Stack>
  );
}
