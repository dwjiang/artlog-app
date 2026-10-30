import { useMutation } from "convex/react";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { getNetworkStateAsync } from "expo-network";
import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { isTransientError } from "@/lib/network-error";
import { isOffline } from "@/lib/network-state";
import { reportError } from "@/lib/observability";
import { reportIfStalled } from "@/lib/stall-report";
import { useDeviceReady } from "@/lib/use-device-ready";

import { api } from "../../../convex/_generated/api";
import { useNotificationPermission } from "./permission";
import { useNotificationPreferences } from "./preferences";

const PUSH_TOKEN_STALL_MS = 30_000;

/**
 * Gives the server this installation's push token and which pushes it wants. Runs on launch and whenever permission or
 * a preference changes; a failed attempt retries the next time the app comes to the foreground.
 */
export function PushRegistration() {
  const ready = useDeviceReady();
  const permission = useNotificationPermission();
  const { preferences } = useNotificationPreferences();
  const register = useMutation(api.push.register);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const friends = preferences?.friends;
  const reactions = preferences?.reactions;
  const companions = preferences?.companions;
  const mentions = preferences?.mentions;
  useEffect(() => {
    if (!failed) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setAttempt((count) => count + 1);
    });
    return () => subscription.remove();
  }, [failed]);
  useEffect(() => {
    if (
      !ready
      || permission !== "granted"
      || friends === undefined
      || reactions === undefined
      || companions === undefined
      || mentions === undefined
    ) {
      return;
    }
    let cancelled = false;
    let stage = "token";
    const data = () => ({ stage, is_device: Device.isDevice, attempt });
    void (async () => {
      try {
        const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
        // Simulator builds carry no provisioning profile, so Expo would file their sandbox tokens as production.
        // The token waits on Apple's push service with no timeout, so a missing callback would otherwise go unseen.
        const { data: token } = await reportIfStalled(
          Notifications.getExpoPushTokenAsync({ projectId, development: !Device.isDevice }),
          "notifications.push.token_stalled",
          PUSH_TOKEN_STALL_MS,
          { requiresNetwork: true, data },
        );
        if (cancelled) return;
        stage = "register";
        await register({ token, friends, reactions, companions, mentions });
        if (!cancelled) setFailed(false);
      } catch (cause) {
        if (cancelled) return;
        setFailed(true);
        const network = await getNetworkStateAsync().catch(() => undefined);
        if (isTransientError(cause) || (network && isOffline(network))) return;
        reportError(cause, "notifications.push.register", { level: "warning", data: data() });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, permission, friends, reactions, companions, mentions, register, attempt]);
  return null;
}
