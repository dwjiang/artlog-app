import type { VenueRow } from "@/lib/venue/resolve";
import { calendarDate } from "@/shared/journal/limits";

import { dateFromPicker, moveVisitTimes, pickerDate, validVisitDate, venueTimeZone } from "./visit-date";

it("round trips calendar dates without UTC conversion, including leap days", () => {
  for (const value of ["2024-02-29", "2026-03-08", "2026-11-01"]) {
    expect(dateFromPicker(pickerDate(value))).toBe(value);
  }
});

it("rejects future dates using the museum day across the international date line", () => {
  const now = Date.parse("2026-09-15T10:30:00Z");
  expect(validVisitDate("2026-09-16", "Pacific/Kiritimati", now)).toBe(true);
  expect(validVisitDate("2026-09-16", "America/Los_Angeles", now)).toBe(false);
  expect(validVisitDate("2025-02-29", "UTC", now)).toBe(false);
});

it("uses museum coordinates for its timezone", () => {
  expect(venueTimeZone({ lat: 40.7794, lng: -73.9632 } as VenueRow)).toBe("America/New_York");
});

describe("moveVisitTimes", () => {
  const now = Date.parse("2026-09-26T18:00:00Z");

  it("keeps the clock times and length on the new day, across a daylight-saving change", () => {
    const startedAt = Date.parse("2026-03-07T14:30:00-05:00");
    const moved = moveVisitTimes(
      { startedAt, endedAt: startedAt + 90 * 60_000, timeZone: "America/New_York" },
      { visitedOn: "2026-03-09", timeZone: "America/New_York" },
      now,
    );
    expect(moved).toEqual({
      startedAt: Date.parse("2026-03-09T14:30:00-04:00"),
      endedAt: Date.parse("2026-03-09T16:00:00-04:00"),
    });
  });

  it("keeps the museum's clock time when the visit moves to another time zone", () => {
    const startedAt = Date.parse("2026-09-12T23:30:00-04:00");
    const moved = moveVisitTimes(
      { startedAt, endedAt: null, timeZone: "America/New_York" },
      { visitedOn: "2026-09-12", timeZone: "Europe/London" },
      now,
    );
    expect(moved).toEqual({ startedAt: Date.parse("2026-09-12T23:30:00+01:00"), endedAt: null });
    expect(calendarDate(moved.startedAt!, "Europe/London")).toBe("2026-09-12");
  });

  it("stops a visit moved to today at the present", () => {
    const startedAt = Date.parse("2026-09-20T19:00:00Z");
    expect(
      moveVisitTimes(
        { startedAt, endedAt: startedAt + 3_600_000, timeZone: "UTC" },
        { visitedOn: "2026-09-26", timeZone: "UTC" },
        now,
      ),
    ).toEqual({ startedAt: now, endedAt: now });
  });

  it("stays on the new day when its clock time is skipped by daylight saving at midnight", () => {
    const startedAt = Date.parse("2026-09-05T00:30:00-04:00");
    const moved = moveVisitTimes(
      { startedAt, endedAt: null, timeZone: "America/Santiago" },
      { visitedOn: "2026-09-06", timeZone: "America/Santiago" },
      now,
    );
    expect(calendarDate(moved.startedAt!, "America/Santiago")).toBe("2026-09-06");
  });

  it("leaves a visit without times untouched", () => {
    expect(
      moveVisitTimes(
        { startedAt: null, endedAt: null, timeZone: "UTC" },
        { visitedOn: "2026-09-01", timeZone: "Asia/Tokyo" },
        now,
      ),
    ).toEqual({ startedAt: null, endedAt: null });
  });
});
