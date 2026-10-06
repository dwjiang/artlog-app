import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { Linking } from "react-native";

import { db } from "@/db/client";
import { settings } from "@/db/schema";
import { readPreferences } from "@/lib/notifications/preferences";

import { NotificationPreferences } from "./notification-preferences";

jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));

const permission = (status: number) => ({ status: "", granted: status === 2, ios: { status } }) as never;

beforeEach(async () => {
  jest.clearAllMocks();
  await db.delete(settings);
});

it("turns each kind of notification on or off on this iPhone", async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(2));
  await render(<NotificationPreferences />);
  const reactions = await screen.findByRole("switch", { name: "Likes and comments" });
  await waitFor(() => expect(reactions).toBeEnabled());
  expect(screen.getByRole("switch", { name: "Friend requests" })).toBeChecked();
  expect(screen.getByRole("switch", { name: "Mentions" })).toBeChecked();
  expect(screen.getByRole("switch", { name: "Visits you’re added to" })).toBeChecked();
  expect(screen.getByRole("switch", { name: "Visit reminders" })).toBeChecked();

  await fireEvent.press(reactions);
  await fireEvent.press(screen.getByRole("switch", { name: "Visits you’re added to" }));

  await waitFor(() => expect(screen.getByRole("switch", { name: "Visits you’re added to" })).not.toBeChecked());
  expect(screen.getByRole("switch", { name: "Likes and comments" })).not.toBeChecked();
  expect(readPreferences(await db.select().from(settings))).toEqual({
    friends: true,
    reactions: false,
    mentions: true,
    companions: false,
    visitReminders: true,
  });
});

it("points to the Settings app after notifications were declined", async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(1));
  const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
  await render(<NotificationPreferences />);

  await fireEvent.press(await screen.findByRole("button", { name: "Open Settings" }));

  expect(openSettings).toHaveBeenCalled();
  expect(screen.getByText("Notifications are off for Artlog. Turn them on in the Settings app.")).toBeOnTheScreen();
  expect(screen.getByRole("switch", { name: "Friend requests" })).toBeDisabled();
});

it("asks iOS when notifications were never offered", async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(0));
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce(permission(2));
  await render(<NotificationPreferences />);

  await fireEvent.press(await screen.findByRole("button", { name: "Turn on notifications" }));

  expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("switch", { name: "Friend requests" })).toBeEnabled());
  expect(screen.queryByRole("button", { name: "Turn on notifications" })).toBeNull();
});
