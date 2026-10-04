import "@/lib/sentry";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import * as Sentry from "@sentry/react-native";
import { DefaultTheme, ThemeProvider, type ErrorBoundaryProps } from "expo-router";
import { Stack } from "expo-router/stack";
import { useEffect } from "react";

import { ProfileSetupPrompt } from "@/components/account/profile-setup-prompt";
import { AppDiagnostics } from "@/components/app-diagnostics";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { AppUpdateGate } from "@/components/app-update-gate";
import { DockedPlayerInsets, ListeningRoot } from "@/components/audio/listening-root";
import { RemovalToast } from "@/components/collection/removal-toast";
import { DatabaseGate } from "@/components/database-gate";
import { ToastLayer } from "@/components/toast";
import { Gallery, NavigationTheme } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { CollectionSync } from "@/lib/account/collection-sync";
import { ListeningProvider } from "@/lib/audio/listening-provider";
import { convex } from "@/lib/convex-client";
import { DeviceIdentity } from "@/lib/device-identity";
import { warmUpEmbedder } from "@/lib/embed/embedder";
import { PhotoMaintenance } from "@/lib/files/photo-maintenance-lifecycle";
import { limitImageCache } from "@/lib/image-cache";
import { installationStorage } from "@/lib/installation-storage";
import { MuseumDownloadLifecycle } from "@/lib/museum-downloads/use-museum-downloads";
import { NotificationResponder } from "@/lib/notifications/notification-responder";
import { PushRegistration } from "@/lib/notifications/push-registration";
import { VisitReminderSync } from "@/lib/notifications/visit-reminder-sync";
import { QueueFlusher } from "@/lib/queue/use-queue";
import { VenueResolver } from "@/lib/venue/use-venue";
import { VisitActivitySync } from "@/lib/widgets/visit-activity-sync";
import { WidgetProvider } from "@/lib/widgets/widget-provider";

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <AppErrorBoundary {...props} />;
}

export const unstable_settings = {
  anchor: "(tabs)",
};

function RootLayout() {
  return (
    <>
      <AppDiagnostics />
      <AppUpdateGate>
        <AppContent />
      </AppUpdateGate>
    </>
  );
}

function AppContent() {
  const reduced = useReducedMotion();
  useEffect(warmUpEmbedder, []);
  useEffect(limitImageCache, []);
  return (
    <DatabaseGate>
      <PhotoMaintenance />
      <ConvexAuthProvider client={convex} storage={installationStorage}>
        <DeviceIdentity />
        <CollectionSync />
        <ProfileSetupPrompt />
        <QueueFlusher />
        <MuseumDownloadLifecycle />
        <VenueResolver />
        <VisitActivitySync />
        <VisitReminderSync />
        <PushRegistration />
        <WidgetProvider>
          <ThemeProvider value={navigationTheme}>
            <ListeningProvider>
              <ListeningRoot>
                <Stack
                  screenOptions={{
                    ...NavigationTheme,
                    animation: reduced ? "fade" : "default",
                    animationMatchesGesture: true,
                    headerBackButtonDisplayMode: "default",
                  }}
                  screenLayout={({ options, children }) => (
                    <DockedPlayerInsets modal={!!options.presentation && options.presentation !== "card"}>
                      {children}
                    </DockedPlayerInsets>
                  )}
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
                        reduced || (route.params as { entrance?: string } | undefined)?.entrance === "capture"
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
                  <Stack.Screen name="enter-details/[scanId]" options={{ title: "Details" }} />
                  <Stack.Screen
                    name="sign-in"
                    dangerouslySingular
                    options={{
                      presentation: "formSheet",
                      sheetAllowedDetents: "fitToContents",
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
                  <Stack.Screen name="settings" options={{ title: "", headerBackTitle: "Collection" }} />
                  <Stack.Screen name="widgets" options={{ title: "", headerBackTitle: "Settings" }} />
                  <Stack.Screen name="saved/[savedId]" options={{ title: "" }} />
                  <Stack.Screen name="wall-display" options={{ title: "" }} />
                  <Stack.Screen
                    name="journal/[visitId]"
                    options={{
                      title: "Visit details",
                      headerLargeTitle: true,
                      headerTransparent: true,
                      headerStyle: { backgroundColor: Gallery.groupedBackground },
                      // An opaque large-header background hides the re-expanded title on iOS 26.
                      headerLargeStyle: { backgroundColor: "transparent" },
                      headerLargeTitleShadowVisible: false,
                      contentStyle: { backgroundColor: Gallery.groupedBackground },
                    }}
                  />
                  <Stack.Screen name="adjust-crop" options={{ title: "Adjust crop", gestureEnabled: false }} />
                  <Stack.Screen name="photo-details" options={{ title: "Photo details" }} />
                  <Stack.Screen name="identify-artwork" options={{ title: "Artwork details" }} />
                  <Stack.Screen name="leaderboards" options={{ title: "Leaderboards" }} />
                  <Stack.Screen name="people" options={{ ...groupedScreen, title: "Friends" }} />
                  <Stack.Screen name="blocked-people" options={{ ...groupedScreen, title: "Blocked people" }} />
                  <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
                  <Stack.Screen name="profile/[profileId]" options={{ title: "Profile" }} />
                  <Stack.Screen name="profile-friends" options={{ ...groupedScreen, title: "Friends" }} />
                  <Stack.Screen name="visit/[postId]" options={{ title: "Visit" }} />
                  <Stack.Screen name="edit-profile" options={{ ...visitSheet, title: "Edit profile" }} />
                  <Stack.Screen name="share-profile" options={{ ...groupedScreen, title: "Share profile" }} />
                  <Stack.Screen
                    name="create-profile"
                    options={{
                      presentation: "fullScreenModal",
                      headerShown: false,
                      gestureEnabled: false,
                    }}
                  />
                  <Stack.Screen name="artwork" options={{ title: "" }} />
                  <Stack.Screen name="visit-create" options={{ ...visitSheet, ...groupedScreen, title: "Add visit" }} />
                  <Stack.Screen name="capture-context" options={groupedScreen} />
                  <Stack.Screen name="link-artwork" options={groupedScreen} />
                  <Stack.Screen
                    name="visit-museum"
                    options={{ ...visitSheet, ...groupedScreen, title: "Change museum" }}
                  />
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
                      ...groupedScreen,
                    }}
                  />
                  <Stack.Screen
                    name="visit-add"
                    options={{
                      presentation: "formSheet",
                      sheetAllowedDetents: "fitToContents",
                      sheetGrabberVisible: true,
                      headerShown: false,
                      ...groupedScreen,
                    }}
                  />
                  <Stack.Screen
                    name="dont-miss"
                    options={{
                      presentation: "formSheet",
                      sheetAllowedDetents: "fitToContents",
                      sheetGrabberVisible: true,
                      headerShown: false,
                    }}
                  />
                  <Stack.Screen
                    name="visit-wrap-up"
                    options={{
                      presentation: "formSheet",
                      sheetAllowedDetents: "fitToContents",
                      sheetGrabberVisible: true,
                      headerShown: false,
                    }}
                  />
                  <Stack.Screen
                    name="turn-on-notifications"
                    dangerouslySingular
                    options={{
                      presentation: "formSheet",
                      sheetAllowedDetents: "fitToContents",
                      sheetGrabberVisible: true,
                      headerShown: false,
                    }}
                  />
                  <Stack.Screen
                    name="send-feedback"
                    options={{
                      presentation: "formSheet",
                      sheetAllowedDetents: "fitToContents",
                      sheetGrabberVisible: true,
                      headerShown: false,
                    }}
                  />
                  <Stack.Screen
                    name="report"
                    options={{
                      presentation: "formSheet",
                      sheetAllowedDetents: "fitToContents",
                      sheetGrabberVisible: true,
                      headerShown: false,
                      ...groupedScreen,
                    }}
                  />
                  <Stack.Screen
                    name="queue"
                    dangerouslySingular
                    options={{
                      presentation: "formSheet",
                      sheetAllowedDetents: "fitToContents",
                      sheetGrabberVisible: true,
                      headerShown: false,
                    }}
                  />
                </Stack>
                <NotificationResponder />
              </ListeningRoot>
            </ListeningProvider>
            <ToastLayer>
              <RemovalToast />
            </ToastLayer>
          </ThemeProvider>
        </WidgetProvider>
      </ConvexAuthProvider>
    </DatabaseGate>
  );
}

/** Gray page behind the white cards of `ListRow` lists. */
const groupedScreen = {
  headerStyle: { backgroundColor: Gallery.groupedBackground },
  contentStyle: { backgroundColor: Gallery.groupedBackground },
};

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
