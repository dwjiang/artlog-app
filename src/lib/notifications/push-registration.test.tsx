import { render, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import { db } from "@/db/client";
import { settings } from "@/db/schema";

import { setNotificationPreference } from "./preferences";
import { PushRegistration } from "./push-registration";

const mockRegister = jest.fn(async (_: unknown) => null);
let mockReady = true;
jest.mock("@/db/client", () => ({ db: jest.requireActual("@/db/test-db").createTestDatabase() }));
jest.mock("@/lib/use-device-ready", () => ({ useDeviceReady: () => mockReady }));
jest.mock("convex/react", () => ({ useMutation: () => mockRegister }));

const permission = (status: number) => ({ status: "", granted: status === 2, ios: { status } }) as never;

beforeEach(async () => {
  jest.clearAllMocks();
  mockReady = true;
  await db.delete(settings);
});

it("registers this iPhone's push token with the pushes it wants, again after a change", async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(2));
  await render(<PushRegistration />);
  await waitFor(() =>
    expect(mockRegister).toHaveBeenCalledWith({
      token: "ExponentPushToken[test]",
      friends: true,
      reactions: true,
      companions: true,
      mentions: true,
    }),
  );

  await setNotificationPreference("reactions", false);
  await setNotificationPreference("companions", false);
  await setNotificationPreference("mentions", false);

  await waitFor(() =>
    expect(mockRegister).toHaveBeenLastCalledWith({
      token: "ExponentPushToken[test]",
      friends: true,
      reactions: false,
      companions: false,
      mentions: false,
    }),
  );
});

it("asks for no token until notifications are allowed and the device is registered", async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(1));
  const view = await render(<PushRegistration />);
  await waitFor(() => expect(Notifications.getPermissionsAsync).toHaveBeenCalled());

  mockReady = false;
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(2));
  await view.rerender(<PushRegistration />);

  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  expect(mockRegister).not.toHaveBeenCalled();
});
