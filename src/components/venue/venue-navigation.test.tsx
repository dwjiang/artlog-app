import { act } from "@testing-library/react-native";
import { router } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import type { PropsWithChildren } from "react";
import { Text } from "react-native";

import RootLayout, { unstable_settings } from "@/app/_layout";

jest.mock("@/lib/audio/listening-provider", () => ({
  ListeningProvider: ({ children }: { children: import("react").ReactNode }) => children,
}));
jest.mock("@/components/audio/docked-player", () => ({
  DockedPlayerLayout: ({ children }: PropsWithChildren) => children,
}));
jest.mock("@/lib/use-app-compatibility", () => ({
  useAppCompatibility: () => ({ loading: false, updateRequired: false }),
}));
jest.mock("@convex-dev/auth/react", () => ({
  ConvexAuthProvider: ({ children }: PropsWithChildren) => children,
}));
jest.mock("@/components/database-gate", () => ({
  DatabaseGate: ({ children }: PropsWithChildren) => children,
}));
jest.mock("@/lib/convex-client", () => ({ convex: {} }));
jest.mock("@/lib/installation-storage", () => ({ installationStorage: {} }));
jest.mock("@/lib/device-identity", () => ({ DeviceIdentity: () => null }));
jest.mock("@/lib/files/photo-maintenance-lifecycle", () => ({ PhotoMaintenance: () => null }));
jest.mock("@/lib/account/collection-sync", () => ({
  CollectionSync: () => null,
}));
jest.mock("@/components/account/profile-setup-prompt", () => ({
  ProfileSetupPrompt: () => null,
}));
jest.mock("@/lib/embed/embedder", () => ({ warmUpEmbedder: () => {} }));
jest.mock("@/lib/queue/use-queue", () => ({ QueueFlusher: () => null }));
jest.mock("@/lib/museum-downloads/use-museum-downloads", () => ({
  MuseumDownloadLifecycle: () => null,
}));
jest.mock("@/lib/venue/use-venue", () => ({ VenueResolver: () => null }));
jest.mock("@/lib/widgets/visit-activity-sync", () => ({ VisitActivitySync: () => null }));
jest.mock("@/lib/notifications/visit-reminder-sync", () => ({ VisitReminderSync: () => null }));
jest.mock("@/lib/notifications/exhibition-reminder-sync", () => ({ ExhibitionReminderSync: () => null }));
jest.mock("@/lib/notifications/push-registration", () => ({ PushRegistration: () => null }));
jest.mock("@/lib/widgets/widget-provider", () => ({
  WidgetProvider: ({ children }: PropsWithChildren) => children,
}));

afterEach(() => jest.useRealTimers());

it("returns to Scan after dismissing a picker opened by both a tap and a later venue prompt", async () => {
  const navigation = renderRouter({
    _layout: { default: () => <RootLayout />, unstable_settings },
    "(tabs)/index": () => <Text>Scan</Text>,
    "venue-picker": () => <Text>Museum picker</Text>,
  });
  await navigation;

  await act(() => router.push("/venue-picker"));
  expect(navigation.getPathname()).toBe("/venue-picker");
  await act(() => router.push("/venue-picker"));
  await act(() => router.back());
  expect(navigation.getPathname()).toBe("/");

  await act(() => router.push("/venue-picker"));
  expect(navigation.getPathname()).toBe("/venue-picker");
  await act(() => router.back());
  expect(navigation.getPathname()).toBe("/");
});
