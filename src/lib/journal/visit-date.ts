import tzLookup from "@photostructure/tz-lookup";
import { calendarDate, isCalendarDate } from "@/shared/journal/limits";
import type { VenueRow } from "../venue/resolve";

export function venueTimeZone(venue: Pick<VenueRow, "lat" | "lng">): string {
  return tzLookup(venue.lat, venue.lng);
}
/** The museum's calendar day at `at`: visits resume for the rest of it, and a museum picked by hand stands for it. */
export function museumDay(
  venue: Pick<VenueRow, "lat" | "lng">,
  at: number,
): { timeZone: string; visitedOn: string } {
  const timeZone = venueTimeZone(venue);
  return { timeZone, visitedOn: calendarDate(at, timeZone) };
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
export function validVisitDate(value: string, timeZone: string, now = Date.now()): boolean {
  return isCalendarDate(value) && value <= calendarDate(now, timeZone);
}
