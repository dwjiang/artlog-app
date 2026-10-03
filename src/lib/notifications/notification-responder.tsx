import * as Notifications from "expo-notifications";
import { router, type Href } from "expo-router";
import { useEffect } from "react";

// A push that arrives while Artlog is open still shows its banner, without the sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

/** The in-app path a notification opens, from the `url` its sender put in the payload. */
export function notificationPath(response: Notifications.NotificationResponse): Href | undefined {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const url: unknown = response.notification.request.content.data?.url;
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? (url as Href) : undefined;
}

/** Opens what a tapped notification points at, including the tap that launched the app. Mount after the navigator. */
export function NotificationResponder() {
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!response) return;
    Notifications.clearLastNotificationResponse();
    const path = notificationPath(response);
    if (path) router.push(path);
  }, [response]);
  return null;
}
