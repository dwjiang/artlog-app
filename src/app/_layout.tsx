import "@/lib/sentry";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import * as Sentry from "@sentry/react-native";
import { DefaultTheme, ThemeProvider, type ErrorBoundaryProps } from "expo-router";
import { getFocusedRouteNameFromRoute } from "expo-router/react-navigation";
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
import { TabTitles } from "@/constants/tabs";
import { Gallery, LargeTitleHeader, NavigationTheme, ScrollTitleHeader, TransparentHeader } from "@/constants/theme";
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

import { setBackButtonTint } from "../../modules/back-button-tint/src";

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <AppErrorBoundary {...props} />;
}

export const unstable_settings = {
  anchor: "(tabs)",
};

setBackButtonTint(NavigationTheme.headerTintColor);

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
                  <Stack.Screen
                    name="(tabs)"
                    options={({ route }) => ({
                      headerShown: false,
                      title: TabTitles[getFocusedRouteNameFromRoute(route) ?? "(home)"],
                    })}
                  />
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
                  <Stack.Screen name="all-artworks" options={{ ...LargeTitleHeader, title: "All Artworks" }} />
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
                  <Stack.Screen name="settings-detail" options={{ ...TransparentHeader, title: "Settings" }} />
                  <Stack.Screen name="settings" options={{ ...LargeTitleHeader, title: "Settings" }} />
                  <Stack.Screen name="widgets" options={{ ...LargeTitleHeader, title: "Widgets" }} />
                  <Stack.Screen name="saved/[savedId]" options={ScrollTitleHeader} />
                  <Stack.Screen name="wall-display" options={ScrollTitleHeader} />
                  <Stack.Screen
                    name="journal/[visitId]"
                    options={{ ...LargeTitleHeader, ...groupedScreen, title: "Visit Details" }}
                  />
                  <Stack.Screen name="adjust-crop" options={{ title: "Adjust Crop", gestureEnabled: false }} />
                  <Stack.Screen name="photo-details" options={{ ...TransparentHeader, title: "Photo Details" }} />
                  <Stack.Screen name="identify-artwork" options={{ ...TransparentHeader, title: "Artwork Details" }} />
                  <Stack.Screen name="add-photos" options={TransparentHeader} />
                  <Stack.Screen name="leaderboards" options={{ ...LargeTitleHeader, title: "Leaderboards" }} />
                  <Stack.Screen name="people" options={{ ...LargeTitleHeader, ...groupedScreen, title: "Friends" }} />
                  <Stack.Screen
                    name="blocked-people"
                    options={{ ...TransparentHeader, ...groupedScreen, title: "Blocked People" }}
                  />
                  <Stack.Screen name="notifications" options={{ ...LargeTitleHeader, title: "Notifications" }} />
                  <Stack.Screen name="profile/[profileId]" options={ScrollTitleHeader} />
                  <Stack.Screen
                    name="profile-friends"
                    options={{ ...TransparentHeader, ...groupedScreen, title: "Friends" }}
                  />
                  <Stack.Screen name="visit/[postId]" options={{ ...TransparentHeader, title: "Post" }} />
                  <Stack.Screen name="tag/[tag]" options={LargeTitleHeader} />
                  <Stack.Screen name="edit-profile" options={{ ...visitSheet, title: "Edit Profile" }} />
                  <Stack.Screen
                    name="share-profile"
                    options={{ ...TransparentHeader, ...groupedScreen, title: "Share Profile" }}
                  />
                  <Stack.Screen
                    name="create-profile"
                    options={{
                      presentation: "fullScreenModal",
                      headerShown: false,
                      gestureEnabled: false,
                    }}
                  />
                  <Stack.Screen name="artwork" options={ScrollTitleHeader} />
                  <Stack.Screen
                    name="visit-create"
                    options={{ ...visitSheet, ...TransparentHeader, ...groupedScreen, title: "Add Visit" }}
                  />
                  <Stack.Screen name="capture-context" options={{ ...TransparentHeader, ...groupedScreen }} />
                  <Stack.Screen name="link-artwork" options={{ ...TransparentHeader, ...groupedScreen }} />
                  <Stack.Screen
                    name="visit-museum"
                    options={{ ...visitSheet, ...TransparentHeader, ...groupedScreen, title: "Change Museum" }}
                  />
                  <Stack.Screen name="visit-share/[visitId]" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="visit-globe"
                    options={{
                      presentation: "modal",
                      ...TransparentHeader,
                      title: "Visited Museums",
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
                    // App Review (5.1.1(iv)): a pre-prompt must not be closable before the iPhone prompt appears.
                    options={{
                      presentation: "formSheet",
                      sheetAllowedDetents: "fitToContents",
                      gestureEnabled: false,
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
