import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect } from 'react';

import { Gallery } from '@/constants/theme';
import { DatabaseGate } from '@/components/database-gate';
import { CollectionSync } from '@/lib/account/collection-sync';
import { convex } from '@/lib/convex-client';
import { installationStorage } from '@/lib/installation-storage';
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
      <ConvexAuthProvider client={convex} storage={installationStorage}>
        <DeviceIdentity />
        <CollectionSync />
        <QueueFlusher />
        <VenueResolver />
        <ThemeProvider value={DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="visit-create" options={{ ...visitSheet, title: 'Add visit' }} />
            <Stack.Screen name="visit-reflection" options={{ ...visitSheet, title: 'Private reflection' }} />
            <Stack.Screen name="visit-share/[visitId]" options={{ ...visitSheet, headerShown: false }} />
            <Stack.Screen name="visit-globe" options={{ presentation: 'modal', title: 'Your world', headerTintColor: Gallery.accent,
              headerStyle: { backgroundColor: Gallery.paper } }} />
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

const visitSheet = {
  presentation: 'formSheet' as const, sheetAllowedDetents: [1], sheetGrabberVisible: true,
  headerShown: true, headerTintColor: Gallery.accent, headerStyle: { backgroundColor: Gallery.paper },
  contentStyle: { backgroundColor: Gallery.paper }, headerShadowVisible: false,
};
