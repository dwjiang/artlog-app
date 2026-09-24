import "@/lib/sentry";
import { ListeningProvider } from "@/lib/audio/listening-provider";
import { ListeningRoot } from "@/components/audio/listening-root";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import * as Sentry from "@sentry/react-native";
import { DefaultTheme, ThemeProvider, type ErrorBoundaryProps } from "expo-router";
import { Stack } from "expo-router/stack";
import { useEffect } from "react";

import { ProfileSetupPrompt } from "@/components/account/profile-setup-prompt";
import { RemovalToast } from "@/components/collection/removal-toast";
import { AppDiagnostics } from "@/components/app-diagnostics";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { DatabaseGate } from "@/components/database-gate";
import { ToastLayer } from "@/components/toast";
import { Gallery, NavigationTheme } from "@/constants/theme";
import { CollectionSync } from "@/lib/account/collection-sync";
import { convex } from "@/lib/convex-client";
import { installationStorage } from "@/lib/installation-storage";
import { DeviceIdentity } from "@/lib/device-identity";
import { warmUpEmbedder } from "@/lib/embed/embedder";
import { MuseumDownloadLifecycle } from "@/lib/museum-downloads/use-museum-downloads";
import { QueueFlusher } from "@/lib/queue/use-queue";
import { VenueResolver } from "@/lib/venue/use-venue";
import { WidgetProvider } from "@/lib/widgets/widget-provider";

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <AppErrorBoundary {...props} />;
}

export const unstable_settings = {
  anchor: "(tabs)",
};

function RootLayout() {
  useEffect(warmUpEmbedder, []);
  return (
    <>
      <AppDiagnostics />
      <DatabaseGate>
        <ConvexAuthProvider client={convex} storage={installationStorage}>
          <DeviceIdentity />
          <CollectionSync />
          <ProfileSetupPrompt />
          <QueueFlusher />
          <MuseumDownloadLifecycle />
          <VenueResolver />
          <WidgetProvider>
            <ThemeProvider value={navigationTheme}>
              <ListeningProvider>
                <ListeningRoot>
                  <Stack
                    screenOptions={{
                      ...NavigationTheme,
                      headerBackButtonDisplayMode: "default",
                    }}
                  >
                    <Stack.Screen
                      name="now-playing"
                      dangerouslySingular
                      options={{
                        presentation: "modal",
                        headerShown: false,
                        contentStyle: { backgroundColor: Gallery.paper },
                      }}
                    />
                    <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Back" }} />
                    <Stack.Screen
                      name="result/[scanId]"
                      options={({ route }) => ({
                        title: "",
                        animation:
                          (route.params as { entrance?: string } | undefined)?.entrance === "capture"
                            ? "fade"
                            : "default",
                      })}
                      listeners={({ navigation, route }) => ({
                        transitionEnd: ({ data }) => {
                          if (
                            !data.closing
                            && (route.params as { entrance?: string } | undefined)?.entrance === "capture"
                          ) {
                            navigation.setParams({ entrance: undefined });
                          }
                        },
                      })}
                    />
                    <Stack.Screen name="all-artworks" options={{ title: "", headerBackTitle: "Collection" }} />
                    <Stack.Screen name="label/[scanId]" options={{ title: "Label" }} />
                    <Stack.Screen
                      name="sign-in"
                      dangerouslySingular
                      options={{
                        presentation: "formSheet",
                        sheetAllowedDetents: [0.62, 1],
                        sheetGrabberVisible: true,
                        headerShown: false,
                      }}
                    />
                    <Stack.Screen
                      name="welcome"
                      options={{
                        presentation: "fullScreenModal",
                        headerShown: false,
                      }}
                    />
                    <Stack.Screen name="settings-detail" options={{ title: "Settings" }} />
                    <Stack.Screen
                      name="museum-downloads"
                      options={{
                        presentation: "fullScreenModal",
                        headerShown: false,
                      }}
                    />
                    <Stack.Screen name="settings" options={{ title: "", headerBackTitle: "Collection" }} />
                    <Stack.Screen name="widgets" options={{ title: "", headerBackTitle: "Settings" }} />
                    <Stack.Screen name="saved/[savedId]" options={{ title: "" }} />
                    <Stack.Screen name="wall-display" options={{ title: "" }} />
                    <Stack.Screen name="journal/[visitId]" options={{ title: "Visit" }} />
                    <Stack.Screen name="adjust-crop" options={{ title: "Adjust crop", gestureEnabled: false }} />
                    <Stack.Screen name="photo-details" options={{ title: "Photo details" }} />
                    <Stack.Screen name="identify-artwork" options={{ title: "Artwork details" }} />
                    <Stack.Screen name="leaderboards" options={{ title: "Leaderboards" }} />
                    <Stack.Screen name="people" options={{ title: "Friends" }} />
                    <Stack.Screen name="profile/[profileId]" options={{ title: "Profile" }} />
                    <Stack.Screen name="visit/[postId]" options={{ title: "Visit" }} />
                    <Stack.Screen name="edit-profile" options={{ ...visitSheet, title: "Edit profile" }} />
                    <Stack.Screen name="share-profile" options={{ title: "Share profile" }} />
                    <Stack.Screen name="public-notes" options={{ title: "Public notes" }} />
                    <Stack.Screen
                      name="create-profile"
                      options={{
                        presentation: "fullScreenModal",
                        headerShown: false,
                        gestureEnabled: false,
                      }}
                    />
                    <Stack.Screen name="artwork" options={{ title: "" }} />
                    <Stack.Screen name="visit-create" options={{ ...visitSheet, title: "Add visit" }} />
                    <Stack.Screen name="visit-share/[visitId]" options={{ headerShown: false }} />
                    <Stack.Screen
                      name="visit-globe"
                      options={{
                        presentation: "modal",
                        title: "Visited museums",
                        headerTintColor: Gallery.accent,
                      }}
                    />
                    <Stack.Screen
                      name="venue-picker"
                      dangerouslySingular
                      options={{
                        presentation: "formSheet",
                        sheetAllowedDetents: "fitToContents",
                        sheetGrabberVisible: true,
                        headerShown: false,
                      }}
                    />
                    <Stack.Screen
                      name="queue"
                      dangerouslySingular
                      options={{
                        presentation: "formSheet",
                        sheetAllowedDetents: [0.75, 1],
                        sheetGrabberVisible: true,
                        headerShown: false,
                      }}
                    />
                  </Stack>
                </ListeningRoot>
              </ListeningProvider>
              <ToastLayer>
                <RemovalToast />
              </ToastLayer>
            </ThemeProvider>
          </WidgetProvider>
        </ConvexAuthProvider>
      </DatabaseGate>
    </>
  );
}

const visitSheet = {
  presentation: "formSheet" as const,
  sheetAllowedDetents: [1],
  sheetGrabberVisible: true,
  headerTintColor: Gallery.accent,
};

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Gallery.accent,
    background: Gallery.paper,
    card: Gallery.paper,
    text: Gallery.ink,
    border: Gallery.separator,
    notification: Gallery.destructive,
  },
};

export default Sentry.wrap(RootLayout);
