import { waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";

import { db } from "@/db/client";
import { getSetting } from "@/db/repos/settings";
import { settings } from "@/db/schema";

import { offerNotifications } from "./offer";

jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

const permission = (status: number) => ({ status: "", granted: status === 2, ios: { status } }) as never;

beforeEach(async () => {
  jest.clearAllMocks();
  await db.delete(settings);
});

it("offers notifications once, the first time a reply is worth hearing about", async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(0));

  offerNotifications();
  await waitFor(() =>
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/turn-on-notifications",
      params: { ask: "notifications" },
    }),
  );
  offerNotifications("exhibitionReminders");
  await waitFor(async () => expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(1));

  expect(router.push).toHaveBeenCalledTimes(1);
});

it("opens the offer with the ask of the action that raised it", async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(0));

  offerNotifications("exhibitionReminders");

  await waitFor(() =>
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/turn-on-notifications",
      params: { ask: "exhibitionReminders" },
    }),
  );
});

it("never offers once the person has answered the iOS prompt", async () => {
  for (const status of [1, 2]) {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce(permission(status));
    offerNotifications();
    await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalled());
    jest.mocked(Notifications.getPermissionsAsync).mockClear();
  }

  expect(router.push).not.toHaveBeenCalled();
  expect(await getSetting("notifications-offered")).toBeUndefined();
});
