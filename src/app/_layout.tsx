import { ConvexProvider } from 'convex/react';
import { DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';

import { convex } from '@/lib/convex-client';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <ConvexProvider client={convex}>
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
    </ConvexProvider>
  );
}
