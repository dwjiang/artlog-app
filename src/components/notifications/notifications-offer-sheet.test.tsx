import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";

import { NotificationsOfferSheet } from "./notifications-offer-sheet";

jest.mock("expo-router", () => ({ router: { back: jest.fn() } }));

afterEach(() => jest.clearAllMocks());

it("raises the iOS prompt only from its primary button, then closes", async () => {
  await render(<NotificationsOfferSheet />);
  expect(screen.getByRole("header", { name: "Hear back from friends." })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Allow notifications" }));

  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(router.back).toHaveBeenCalled());
});

it("closes without asking when the person chooses Not now", async () => {
  await render(<NotificationsOfferSheet />);

  await fireEvent.press(screen.getByRole("button", { name: "Not now" }));

  expect(router.back).toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});
