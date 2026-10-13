import * as Notifications from "expo-notifications";

import type { Exhibition } from "@/lib/explore/types";

export const EXHIBITION_REMINDER_PREFIX = "exhibition-";

export type ReminderShow = Pick<Exhibition, "id" | "title" | "startsOn" | "endsOn"> & { museum?: string };
const REMINDER_HOUR = 9;
const CLOSING_NOTICE_DAYS = 7;

/** 9 AM by the phone's clock, `daysBefore` days ahead of a calendar date. */
function morningOf(date: string, daysBefore = 0): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day - daysBefore, REMINDER_HOUR).getTime();
}

/** "Sunday, Jan 24" from a calendar date, without a time zone shifting the day. */
const longDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(
    Date.parse(date),
  );

export type ReminderTime = { kind: "opening" | "closing"; at: number };

/**
 * When a saved show's reminders come, still ahead of `now`: 9 AM on opening day, and 9 AM a week before the last day
 * unless the whole run is shorter than that.
 */
export function reminderTimes({ startsOn, endsOn }: Pick<ReminderShow, "startsOn" | "endsOn">, now: number) {
  const opens = startsOn ? morningOf(startsOn) : undefined;
  const closes = morningOf(endsOn, CLOSING_NOTICE_DAYS);
  const times: ReminderTime[] = [];
  if (opens !== undefined && opens > now) times.push({ kind: "opening", at: opens });
  if (closes > now && (opens === undefined || closes > opens)) times.push({ kind: "closing", at: closes });
  return times;
}

/** "Thursday, Oct 23", or "Oct 23" when `short`, for a reminder time on the phone's clock. */
export const reminderDay = (at: number, { short = false } = {}) =>
  new Intl.DateTimeFormat(
    "en-US",
    short ? { month: "short", day: "numeric" } : { weekday: "long", month: "short", day: "numeric" },
  ).format(at);

export function exhibitionReminders(
  { id, title, startsOn, endsOn, museum }: ReminderShow,
  now: number,
): Notifications.NotificationRequestInput[] {
  const at = museum ? ` at ${museum}` : "";
  const data = { url: `/exhibition/${encodeURIComponent(id)}` };
  return reminderTimes({ startsOn, endsOn }, now).map(({ kind, at: date }) => ({
    identifier: `${EXHIBITION_REMINDER_PREFIX}${kind}:${id}`,
    content: {
      body:
        kind === "opening"
          ? `${title} opens today${at}.`
          : // Banners show two lines, so the date comes before the museum name.
            `${title} closes ${longDate(endsOn)}${museum ? `,${at}` : ""}.`,
      data,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(date) } as const,
  }));
}
