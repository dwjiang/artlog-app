import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";

import { useLocalOwner } from "@/lib/account/owner-store";
import { useLatestVisitSave } from "@/lib/journal/use-latest-visit-save";
import { reportError } from "@/lib/observability";
import { useVenue } from "@/lib/venue/use-venue";

import { useNotificationPermission } from "./permission";
import { useNotificationPreferences } from "./preferences";
import { visitReminderAt } from "./visit-reminder";

// Only one visit is open at a time, so one identifier lets each save replace the pending reminder.
const REMINDER_ID = "open-visit-reminder";

/** Keeps one local "wrap up your visit" reminder in step with the open visit and its latest save. */
export function VisitReminderSync() {
  const owner = useLocalOwner();
  const { visit, hydrated } = useVenue();
  const { at: savedAt, loading, error } = useLatestVisitSave(visit?.localId, owner);
  const permission = useNotificationPermission();
  const { preferences } = useNotificationPreferences();
  const localId = visit?.localId;
  const venueName = visit?.venueName;
  const at = visit && !error ? visitReminderAt(Math.max(visit.startedAt, savedAt ?? 0)) : undefined;
  const wanted = permission === "granted" && preferences?.visitReminders === true;
  const settled = hydrated && permission !== undefined && !!preferences && !loading;
  // Native calls cannot be cancelled once started; finish each before applying the next state.
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    if (!settled) return;
    writes.current = writes.current
      .then(async () => {
        if (!wanted || !localId || at === undefined || at <= Date.now()) {
          await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
          return;
        }
        await Notifications.scheduleNotificationAsync({
          identifier: REMINDER_ID,
          content: {
            body: `Still at ${venueName}? Wrap up your visit.`,
            data: { url: `/journal/${encodeURIComponent(localId)}?endVisit=true` },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
        });
      })
      .catch((cause: unknown) => reportError(cause, "visit.reminder", { level: "warning" }));
  }, [settled, wanted, localId, venueName, at]);
  return null;
}
