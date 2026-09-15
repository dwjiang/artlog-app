import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect } from 'react';

import { DatabaseGate } from '@/components/database-gate';
import { Gallery } from '@/constants/theme';
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
          <Stack screenOptions={{ headerTintColor: Gallery.ink, headerStyle: { backgroundColor: Gallery.paper },
            headerTitleStyle: { color: Gallery.ink }, headerLargeTitleStyle: { color: Gallery.ink }, headerBackButtonDisplayMode: 'minimal',
            headerShadowVisible: false, contentStyle: { backgroundColor: Gallery.paper } }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="settings" options={{ title: 'Settings', headerLargeTitleEnabled: true, headerTransparent: true,
              headerStyle: { backgroundColor: 'transparent' }, headerLargeStyle: { backgroundColor: 'transparent' } }} />
            <Stack.Screen name="people" options={{ title: 'Find people', headerLargeTitleEnabled: true, headerTransparent: true,
              headerStyle: { backgroundColor: 'transparent' }, headerLargeStyle: { backgroundColor: 'transparent' } }} />
            <Stack.Screen name="profile/[profileId]" options={{ title: 'Profile' }} />
            <Stack.Screen name="visit/[postId]" options={{ title: 'Visit' }} />
            <Stack.Screen name="create-profile" options={{ title: 'Your profile', presentation: 'formSheet',
              sheetAllowedDetents: [1], sheetGrabberVisible: true }} />
            <Stack.Screen name="artwork" options={{ title: 'Artwork', presentation: 'formSheet',
              sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true }} />
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
