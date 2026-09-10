import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect } from 'react';

import { convex, secureStorage } from '@/lib/convex-client';
import { DeviceIdentity } from '@/lib/device-identity';
import { warmUpEmbedder } from '@/lib/embed/embedder';
// Register the offline database in Metro's asset graph before venue resolution uses it.
import '@/lib/venue-asset';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  useEffect(warmUpEmbedder, []);
  return (
    <ConvexAuthProvider client={convex} storage={secureStorage}>
      <DeviceIdentity />
      <ThemeProvider value={DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="venue-picker"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [0.45],
              sheetGrabberVisible: true,
              headerShown: false,
            }}
          />
        </Stack>
      </ThemeProvider>
    </ConvexAuthProvider>
  );
}
