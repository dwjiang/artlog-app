import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect } from 'react';

import { DatabaseGate } from '@/components/database-gate';
import { convex, secureStorage } from '@/lib/convex-client';
import { DeviceIdentity } from '@/lib/device-identity';
import { warmUpEmbedder } from '@/lib/embed/embedder';
import { QueueFlusher } from '@/lib/queue/use-queue';
import { VenueResolver } from '@/lib/venue/use-venue';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  useEffect(warmUpEmbedder, []);
  return (
    <DatabaseGate>
      <ConvexAuthProvider client={convex} storage={secureStorage}>
        <DeviceIdentity />
        <QueueFlusher />
        <VenueResolver />
        <ThemeProvider value={DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="venue-picker"
              dangerouslySingular
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [0.45],
                sheetGrabberVisible: true,
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="queue"
              dangerouslySingular
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [0.5],
                sheetGrabberVisible: true,
                headerShown: false,
              }}
            />
          </Stack>
        </ThemeProvider>
      </ConvexAuthProvider>
    </DatabaseGate>
  );
}
