import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";

import { NotificationsOfferSheet } from "./notifications-offer-sheet";

jest.mock("expo-router", () => ({ router: { back: jest.fn() } }));

afterEach(() => jest.clearAllMocks());

it("leads only to the iOS prompt, then closes", async () => {
  await render(<NotificationsOfferSheet />);
  expect(screen.getByRole("image", { name: "Notification permission" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Hear back from friends." })).toBeOnTheScreen();
  expect(screen.getByText("Choose which in Settings.")).toBeOnTheScreen();
  // App Review rejects pre-prompts that say "Allow" or offer a way past the iPhone prompt.
  expect(screen.getAllByRole("button").map((button) => button.props.accessibilityLabel)).toEqual(["Continue"]);

  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));

  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(router.back).toHaveBeenCalled());
});
