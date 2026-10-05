import { render, screen, within } from "@testing-library/react-native";
import type { ReactNode } from "react";

import TabsLayout from "@/app/(tabs)/_layout";

let mockUnseen = 0;
jest.mock("@/lib/social/unseen-notifications", () => ({
  ...jest.requireActual("@/lib/social/unseen-notifications"),
  useWatchUnseenNotifications: () => mockUnseen,
}));
jest.mock("expo-router/unstable-native-tabs", () => {
  const { Text, View } = jest.requireActual("react-native");
  const Trigger = ({ children }: { children: ReactNode }) => (
    <View accessible accessibilityRole="tab">
      {children}
    </View>
  );
  return {
    NativeTabs: Object.assign(({ children }: { children: ReactNode }) => <View>{children}</View>, {
      BottomAccessory: () => null,
      Trigger: Object.assign(Trigger, {
        Label: ({ children }: { children: string }) => <Text>{children}</Text>,
        Icon: () => null,
        Badge: ({ children }: { children: string }) => <Text>{children}</Text>,
      }),
    }),
  };
});
jest.mock("expo-router", () => ({
  useNavigation: () => ({ getState: () => undefined, addListener: () => () => {} }),
}));
jest.mock("@/lib/audio/use-listening", () => ({ useHasListeningTrack: () => false }));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({ visit: undefined }) }));
jest.mock("@/components/audio/mini-player", () => ({ MiniPlayer: () => null }));
jest.mock("@/components/visits/visit-bar", () => ({ VisitBar: () => null }));
jest.mock("@/components/visits/visit-player-bar", () => ({ VisitPlayerBar: () => null }));

it("badges only the Home tab with the unseen notification count, capped, and drops the badge at zero", async () => {
  mockUnseen = 12;
  await render(<TabsLayout />);
  const [home, scan, collection] = screen.getAllByRole("tab");
  expect(within(home).getByText("Home")).toBeOnTheScreen();
  expect(within(home).getByText("12")).toBeOnTheScreen();
  expect(within(scan).queryByText("12")).toBeNull();
  expect(within(collection).queryByText("12")).toBeNull();
  mockUnseen = 140;
  await screen.rerender(<TabsLayout />);
  expect(within(screen.getAllByRole("tab")[0]).getByText("99+")).toBeOnTheScreen();
  mockUnseen = 0;
  await screen.rerender(<TabsLayout />);
  expect(within(screen.getAllByRole("tab")[0]).queryByText(/\d/)).toBeNull();
});
