import tzLookup from "@photostructure/tz-lookup";

import type { VenueRow } from "@/lib/venue/resolve";
import { calendarDate, isCalendarDate } from "@/shared/journal/limits";

export function venueTimeZone(venue: Pick<VenueRow, "lat" | "lng">): string {
  return tzLookup(venue.lat, venue.lng);
}
/** The museum's calendar day at `at`: visits resume for the rest of it, and a museum picked by hand stands for it. */
export function museumDay(venue: Pick<VenueRow, "lat" | "lng">, at: number): { timeZone: string; visitedOn: string } {
  const timeZone = venueTimeZone(venue);
  return { timeZone, visitedOn: calendarDate(at, timeZone) };
}

/** The first midnight after `at` in the phone's time zone. */
export function nextLocalMidnight(at: number): number {
  const midnight = new Date(at);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

// DatePicker uses the device timezone. Only its calendar fields belong in the journal.
export function pickerDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date;
}
export function dateFromPicker(value: Date): string {
  return `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
/** `value`, or the museum's today when the device is already on a later calendar day than the museum. */
export function museumDayAtMost(value: string, timeZone: string, now = Date.now()): string {
  const today = calendarDate(now, timeZone);
  return value > today ? today : value;
}
export function validVisitDate(value: string, timeZone: string, now = Date.now()): boolean {
  return isCalendarDate(value) && value <= calendarDate(now, timeZone);
}

const DAY_MS = 86_400_000;

/** The clock time at `at` in `timeZone`, written as if it were UTC. */
function clockAsUtc(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return (
    Date.UTC(part("year"), part("month") - 1, part("day"), part("hour") % 24, part("minute"), part("second"))
    + (at % 1000)
  );
}
/** The instant `visitedOn` in `timeZone` shows `clock`, in milliseconds past midnight. */
function instantOnDay(visitedOn: string, clock: number, timeZone: string): number {
  const [year, month, day] = visitedOn.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day) + clock;
  const guess = wall - (clockAsUtc(wall, timeZone) - wall);
  // A second pass settles a guess that crossed a daylight-saving change.
  return wall - (clockAsUtc(guess, timeZone) - guess);
}
/**
 * A visit's start and end once it moves to another day or museum: the same clock times at the museum on the new day,
 * never later than `now`, so the start still falls on the visit's date.
 */
export function moveVisitTimes(
  visit: { startedAt: number | null; endedAt: number | null; timeZone: string },
  to: { visitedOn: string; timeZone: string },
  now = Date.now(),
): { startedAt: number | null; endedAt: number | null } {
  if (visit.startedAt === null) return { startedAt: null, endedAt: visit.endedAt };
  const clock = ((clockAsUtc(visit.startedAt, visit.timeZone) % DAY_MS) + DAY_MS) % DAY_MS;
  const exact = instantOnDay(to.visitedOn, clock, to.timeZone);
  // A clock time skipped by a daylight-saving change at midnight lands on a neighboring day; noon never is skipped.
  const startedAt =
    calendarDate(exact, to.timeZone) === to.visitedOn ? exact : instantOnDay(to.visitedOn, DAY_MS / 2, to.timeZone);
  return {
    startedAt: Math.min(startedAt, now),
    endedAt: visit.endedAt === null ? null : Math.min(startedAt + visit.endedAt - visit.startedAt, now),
  };
}
