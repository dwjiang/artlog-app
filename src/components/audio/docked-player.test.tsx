import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import { Pressable, Text } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { DockedPlayerLayout } from "./docked-player";

let mockListening = true;
jest.mock("@/lib/audio/use-listening", () => ({ useHasListeningTrack: () => mockListening }));
jest.mock("./mini-player", () => {
  const { Text: MockText } = jest.requireActual<typeof import("react-native")>("react-native");
  return { MiniPlayer: () => <MockText>Mini player</MockText> };
});

function Screen() {
  const [taps, setTaps] = useState(0);
  return (
    <Pressable accessibilityRole="button" onPress={() => setTaps(taps + 1)}>
      <Text>
        bottom {useSafeAreaInsets().bottom}, taps {taps}
      </Text>
    </Pressable>
  );
}

function layout(dockable: boolean) {
  return (
    <SafeAreaInsetsContext.Provider value={{ top: 59, right: 0, bottom: 34, left: 0 }}>
      <DockedPlayerLayout dockable={dockable}>
        <Screen />
      </DockedPlayerLayout>
    </SafeAreaInsetsContext.Provider>
  );
}

beforeEach(() => {
  mockListening = true;
});

it("docks the player under a pushed screen, which drops the home-indicator inset", async () => {
  await render(layout(true));
  expect(screen.getByText("Mini player")).toBeOnTheScreen();
  expect(screen.getByText("bottom 0, taps 0")).toBeOnTheScreen();
});

it("leaves modals and the tabs to their own players", async () => {
  await render(layout(false));
  expect(screen.queryByText("Mini player")).not.toBeOnTheScreen();
  expect(screen.getByText("bottom 34, taps 0")).toBeOnTheScreen();
});

it("keeps the screen mounted when listening starts", async () => {
  mockListening = false;
  await render(layout(true));
  expect(screen.queryByText("Mini player")).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button"));
  mockListening = true;
  await screen.rerender(layout(true));
  expect(screen.getByText("Mini player")).toBeOnTheScreen();
  expect(screen.getByText("bottom 0, taps 1")).toBeOnTheScreen();
});
