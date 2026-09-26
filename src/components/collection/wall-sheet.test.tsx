import { fireEvent, render, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { dismissToast, showErrorToast } from "@/lib/ui/toast";

import { WallSheet } from "./wall-sheet";

jest.mock("expo-router", () => ({ useSegments: () => [] }));

beforeEach(() => {
  jest.useFakeTimers();
  dismissToast();
});
afterEach(() => {
  dismissToast();
  jest.useRealTimers();
});

it("shows a failure and its retry action over native sheet content", async () => {
  const retry = jest.fn();
  await render(
    <WallSheet title="Move photo" onDismiss={jest.fn()}>
      <Pressable accessibilityRole="button" onPress={() => showErrorToast("Couldn’t move this photo.", retry)}>
        <Text>Move photo</Text>
      </Pressable>
    </WallSheet>,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Move photo" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t move this photo.");
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
});
