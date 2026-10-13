import * as Notifications from "expo-notifications";
import { useEffect, useMemo, useRef } from "react";

import { museumById, useExhibitions } from "@/lib/explore/use-explore";
import { useWantToSee } from "@/lib/explore/want-to-see";
import { reportError } from "@/lib/observability";

import { EXHIBITION_REMINDER_PREFIX, exhibitionReminders, type ReminderShow } from "./exhibition-reminders";
import { useNotificationPermission } from "./permission";
import { useNotificationPreferences } from "./preferences";

/**
 * Keeps local reminders in step with the shows in Want to see, so saves from another device, changed dates and the
 * Settings switch all apply without a tap on this iPhone.
 */
export function ExhibitionReminderSync() {
  const wantToSee = useWantToSee();
  const ids = useMemo(() => [...wantToSee.saved].sort(), [wantToSee.saved]);
  const { data } = useExhibitions(ids, { friends: false });
  const permission = useNotificationPermission();
  const { preferences } = useNotificationPreferences();
  const wanted = permission === "granted" && preferences?.exhibitionReminders === true;
  const disabled =
    permission === "denied" || permission === "undetermined" || preferences?.exhibitionReminders === false;
  // Only scheduling needs the saved catalog; a known opt-out cancels even while offline.
  const settled = disabled || (wanted && wantToSee.ready && (ids.length === 0 || !!data));
  // A content key, so location updates that rebuild the catalog leave the reminders alone.
  const shows = useMemo(
    () =>
      JSON.stringify(
        data?.exhibitions.map(({ id, title, startsOn, endsOn, museumId }): ReminderShow => ({
          id,
          title,
          startsOn,
          endsOn,
          museum: museumById(data, museumId)?.name,
        })) ?? [],
      ),
    [data],
  );
  // Native calls cannot be cancelled once started; finish each before applying the next state.
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    if (!settled) return;
    writes.current = writes.current
      .then(async () => {
        const now = Date.now();
        const saved = wanted ? (JSON.parse(shows) as ReminderShow[]) : [];
        const requests = saved.flatMap((show) => exhibitionReminders(show, now));
        const keep = new Set(requests.map((request) => request.identifier));
        for (const { identifier } of await Notifications.getAllScheduledNotificationsAsync()) {
          if (identifier.startsWith(EXHIBITION_REMINDER_PREFIX) && !keep.has(identifier)) {
            await Notifications.cancelScheduledNotificationAsync(identifier);
          }
        }
        // Scheduling an identifier again replaces it, which picks up changed dates and titles.
        for (const request of requests) await Notifications.scheduleNotificationAsync(request);
      })
      .catch((cause: unknown) => reportError(cause, "explore.reminders", { level: "warning" }));
  }, [settled, wanted, shows]);
  return null;
}
