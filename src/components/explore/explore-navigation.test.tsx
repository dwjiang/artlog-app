import { screen } from "@testing-library/react-native";
import { cleanup, renderRouter } from "expo-router/testing-library";
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
jest.mock("@/lib/notifications/push-registration", () => ({ PushRegistration: () => null }));
jest.mock("@/lib/widgets/widget-provider", () => ({
  WidgetProvider: ({ children }: PropsWithChildren) => children,
}));

const runtime = global as typeof global & { __DEV__: boolean };
const paths = [
  "/exhibitions",
  "/exhibition/hokusai",
  "/museum/aic",
  "/museums",
  "/friends-want-to-see",
  "/want-to-see",
  "/explore-map",
];

const ExploreContent = () => <Text>Explore content</Text>;
const routes = {
  _layout: { default: RootLayout, unstable_settings },
  "(tabs)/index": () => <Text>Home</Text>,
  exhibitions: ExploreContent,
  "exhibition/[exhibitionId]": ExploreContent,
  "museum/[museumId]": ExploreContent,
  museums: ExploreContent,
  "friends-want-to-see": ExploreContent,
  "want-to-see": ExploreContent,
  "explore-map": ExploreContent,
};

beforeEach(() => {
  const { warn } = console;
  jest.spyOn(console, "warn").mockImplementation((message, ...args: unknown[]) => {
    // This fixture includes only Home and Explore; the root layout also configures unrelated screens.
    if (
      typeof message === "string"
      && (message.startsWith("[Layout children]: Too many screens defined.")
        || message.startsWith("[Layout children]: No route named"))
    ) {
      return;
    }
    warn(message, ...args);
  });
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

it.each(paths)("opens the release deep link %s", async (path) => {
  jest.replaceProperty(runtime, "__DEV__", false);
  const navigation = renderRouter(routes, { initialUrl: path });
  await navigation;

  expect(navigation.getPathname()).toBe(path);
  expect(screen.getByText("Explore content")).toBeOnTheScreen();
});
