import { router } from "expo-router";

import { getSetting, setSetting } from "@/db/repos/settings";
import { reportError } from "@/lib/observability";

import { notificationPermission } from "./permission";

const OFFERED_KEY = "notifications-offered";

/**
 * Offers notifications once, right after the person does something whose replies they would want to hear about.
 * iOS's notification prompt carries no reason of its own, so the offer explains first and its one button raises it.
 */
export function offerNotifications(ask: "notifications" | "exhibitionReminders" = "notifications"): void {
  void (async () => {
    if ((await getSetting(OFFERED_KEY)) !== undefined) return;
    if ((await notificationPermission()) !== "undetermined") return;
    await setSetting(OFFERED_KEY, "1");
    router.push({ pathname: "/turn-on-notifications", params: { ask } });
  })().catch((cause: unknown) => reportError(cause, "notifications.offer", { level: "warning" }));
}
