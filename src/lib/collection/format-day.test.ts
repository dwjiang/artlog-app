import { formatDay } from "./format-day";

it("formats a day without locale-dependent month names", () => {
  expect(formatDay(new Date(2026, 8, 8, 23, 59).getTime())).toBe("8 Sep 2026");
  expect(formatDay(new Date(2025, 0, 31).getTime())).toBe("31 Jan 2025");
});
