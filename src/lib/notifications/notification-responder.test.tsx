import { render } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";

import { NotificationResponder } from "./notification-responder";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

const tap = (url: unknown, actionIdentifier = Notifications.DEFAULT_ACTION_IDENTIFIER) =>
  ({ actionIdentifier, notification: { request: { content: { data: { url } } } } }) as never;

afterEach(() => jest.clearAllMocks());

it("opens the screen a tapped notification points at, once", async () => {
  jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue(tap("/visit/abc?comments=1"));

  await render(<NotificationResponder />);

  expect(router.push).toHaveBeenCalledWith("/visit/abc?comments=1");
  expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(1);
});

it("ignores taps without an in-app path", async () => {
  for (const response of [tap("https://example.com"), tap("//example.com/x"), tap(42), tap("/profile/a", "reply")]) {
    jest.mocked(Notifications.useLastNotificationResponse).mockReturnValue(response);
    await render(<NotificationResponder />);
  }

  expect(router.push).not.toHaveBeenCalled();
});
