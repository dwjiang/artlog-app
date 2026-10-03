import { visitReminderAt } from "./visit-reminder";

const at = (hours: number, minutes = 0) => new Date(2026, 9, 3, hours, minutes).getTime();

it("reminds three hours after the visit's last save", () => {
  expect(visitReminderAt(at(14, 30))).toBe(at(17, 30));
});

it("stays quiet when the reminder would land late at night", () => {
  expect(visitReminderAt(at(18, 59))).toBe(at(21, 59));
  expect(visitReminderAt(at(19))).toBeUndefined();
  expect(visitReminderAt(at(23))).toBeUndefined();
});
