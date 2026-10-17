import { screen } from "@testing-library/react-native";
import { cleanup, renderRouter } from "expo-router/testing-library";
import type { PropsWithChildren } from "react";
import { Text } from "react-native";

import RootLayout, { unstable_settings } from "@/app/_layout";
import { embedder } from "@/lib/embed/embedder";

const mockWarmUp = jest.fn().mockResolvedValue({ loadMs: 4000, predictMs: 60, alreadyLoaded: false });
const mockEmbed = jest.fn();

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
jest.mock("../../modules/coreml-embed/src", () => ({
  getCoremlEmbed: () => ({
    modelVersion: jest.requireActual("@/shared/model/model-version.json").modelVersion,
    warmUp: mockWarmUp,
    embed: mockEmbed,
  }),
}));
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

const routes = {
  _layout: { default: RootLayout, unstable_settings },
  "(tabs)/index": () => <Text>Home</Text>,
  welcome: () => <Text>Welcome to Artlog</Text>,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(embedder, "warmUp");
  const { warn } = console;
  jest.spyOn(console, "warn").mockImplementation((message, ...args: unknown[]) => {
    // The startup fixture includes only Home and Welcome.
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

it.each([
  ["/", "Home"],
  ["/welcome", "Welcome to Artlog"],
])("opens %s without eagerly warming the recognition model", async (path, title) => {
  const navigation = renderRouter(routes, { initialUrl: path });
  await navigation;

  expect(screen.getByText(title)).toBeOnTheScreen();
  expect(embedder.warmUp).not.toHaveBeenCalled();
  expect(mockWarmUp).not.toHaveBeenCalled();
  expect(mockEmbed).not.toHaveBeenCalled();
});
