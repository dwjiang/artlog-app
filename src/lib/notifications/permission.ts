import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { reportError } from "@/lib/observability";

export type NotificationPermission = "granted" | "denied" | "undetermined";

const listeners = new Set<(permission: NotificationPermission) => void>();
let known: NotificationPermission | undefined;

export function permissionState({ ios, granted, canAskAgain }: Notifications.NotificationPermissionsStatus) {
  switch (ios?.status) {
    case Notifications.IosAuthorizationStatus.AUTHORIZED:
    case Notifications.IosAuthorizationStatus.PROVISIONAL:
    case Notifications.IosAuthorizationStatus.EPHEMERAL:
      return "granted";
    case Notifications.IosAuthorizationStatus.NOT_DETERMINED:
      return "undetermined";
    case Notifications.IosAuthorizationStatus.DENIED:
      return "denied";
    default:
      return granted ? "granted" : canAskAgain ? "undetermined" : "denied";
  }
}

function publish(status: Notifications.NotificationPermissionsStatus): NotificationPermission {
  known = permissionState(status);
  for (const listener of listeners) listener(known);
  return known;
}

export async function notificationPermission(): Promise<NotificationPermission> {
  return publish(await Notifications.getPermissionsAsync());
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  return publish(
    await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }),
  );
}

/** The current permission, rechecked whenever the app returns to the foreground (people change it in Settings). */
export function useNotificationPermission(): NotificationPermission | undefined {
  const [permission, setPermission] = useState(known);
  useEffect(() => {
    const refresh = () =>
      void notificationPermission().catch((cause: unknown) =>
        reportError(cause, "notifications.permission", { level: "warning" }),
      );
    listeners.add(setPermission);
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      listeners.delete(setPermission);
      subscription.remove();
    };
  }, []);
  return permission;
}
