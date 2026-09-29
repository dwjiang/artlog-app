import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { DockedPlayerInsets } from "./listening-root";

let mockSegments = ["result"];
let mockListening = true;
jest.mock("expo-router", () => ({ useSegments: () => mockSegments }));
jest.mock("@/lib/audio/use-listening", () => ({ useHasListeningTrack: () => mockListening }));
jest.mock("./mini-player", () => ({ MiniPlayer: () => null }));

function BottomInset() {
  return <Text>bottom {useSafeAreaInsets().bottom}</Text>;
}

async function renderScreen(modal: boolean) {
  await render(
    <SafeAreaInsetsContext.Provider value={{ top: 59, right: 0, bottom: 34, left: 0 }}>
      <DockedPlayerInsets modal={modal}>
        <BottomInset />
      </DockedPlayerInsets>
    </SafeAreaInsetsContext.Provider>,
  );
}

beforeEach(() => {
  mockSegments = ["result"];
  mockListening = true;
});

it("drops the home-indicator inset from pushed screens that end above the docked player", async () => {
  await renderScreen(false);
  expect(screen.getByText("bottom 0")).toBeOnTheScreen();
});

it("keeps the home-indicator inset for modals, which cover the docked player", async () => {
  await renderScreen(true);
  expect(screen.getByText("bottom 34")).toBeOnTheScreen();
});

it("keeps the home-indicator inset when no player is docked", async () => {
  mockListening = false;
  await renderScreen(false);
  expect(screen.getByText("bottom 34")).toBeOnTheScreen();
});
