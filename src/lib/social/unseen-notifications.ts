import type { FunctionReturnType } from "convex/server";
import { setBadgeCountAsync } from "expo-notifications";
import { createContext, useEffect } from "react";

import { reportError } from "@/lib/observability";
import { groupNotifications } from "@/shared/social/notifications";

import { api } from "../../../convex/_generated/api";
import { useCursorPages } from "./use-social-query";
import { useSocialSession } from "./use-social-session";

type UnseenPage = FunctionReturnType<typeof api.notifications.unseen>;
const unseenPage = (result: UnseenPage) => result;
const notificationId = (item: UnseenPage["page"][number]) => item.id;
const BADGE_CAP = 99;

/** The unseen notification count from `useWatchUnseenNotifications`, provided by the tabs layout. */
export const UnseenNotificationCount = createContext(0);

/**
 * Counts unseen grouped notifications up to the badge cap and keeps the app icon badge in step. Call it once, in the
 * tabs layout, and read the count elsewhere through `UnseenNotificationCount`.
 */
export function useWatchUnseenNotifications() {
  const session = useSocialSession();
  const { items, canLoadMore, loadMore } = useCursorPages(
    api.notifications.unseen,
    session.status === "ready" ? {} : "skip",
    session.key,
    unseenPage,
    notificationId,
  );
  const unseen = groupNotifications(items).length;
  useEffect(() => {
    if (unseen <= BADGE_CAP && canLoadMore) loadMore();
  }, [unseen, canLoadMore, loadMore]);
  // Pushes set the icon badge to the server's unseen count; while Artlog runs, the badge follows this count.
  useEffect(() => {
    setBadgeCountAsync(unseen).catch((cause: unknown) =>
      reportError(cause, "notifications.badge", { level: "warning" }),
    );
  }, [unseen]);
  return unseen;
}

/** The text of a count badge, which is absent at zero. */
export function countBadge(count: number) {
  if (count <= 0) return undefined;
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
}
