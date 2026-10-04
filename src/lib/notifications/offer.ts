import { router } from "expo-router";

import { getSetting, setSetting } from "@/db/repos/settings";
import { reportError } from "@/lib/observability";

import { notificationPermission } from "./permission";

const OFFERED_KEY = "notifications-offered";

/**
 * Offers notifications once, right after the person does something whose replies they would want to hear about.
 * iOS asks only once, so the offer explains first and the system prompt follows only from its primary button.
 */
export function offerNotifications(): void {
  void (async () => {
    if ((await getSetting(OFFERED_KEY)) !== undefined) return;
    if ((await notificationPermission()) !== "undetermined") return;
    await setSetting(OFFERED_KEY, "1");
    router.push("/turn-on-notifications");
  })().catch((cause: unknown) => reportError(cause, "notifications.offer", { level: "warning" }));
}
