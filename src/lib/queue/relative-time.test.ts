import { formatRelativeTime } from "./relative-time";

const now = new Date(2026, 8, 11, 12, 0, 0).getTime();

it.each([
  [0, "Just now"],
  [59_000, "Just now"],
  [60_000, "1 min ago"],
  [59 * 60_000, "59 min ago"],
  [60 * 60_000, "1 h ago"],
  [23.9 * 3_600_000, "23 h ago"],
  [24 * 3_600_000, "Yesterday"],
  [47 * 3_600_000, "Yesterday"],
  [48 * 3_600_000, "2 days ago"],
  [10 * 86_400_000, "10 days ago"],
])('reads %i ms ago as "%s"', (elapsed, expected) => {
  expect(formatRelativeTime(now - elapsed, now)).toBe(expected);
});

it("treats a capture timestamped in the future as just now", () => {
  expect(formatRelativeTime(now + 5_000, now)).toBe("Just now");
});
