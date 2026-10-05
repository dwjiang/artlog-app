const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Just now", "5 min ago", "3h ago", "Yesterday", "4 days ago": a queued scan rarely outlives a week. */
export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - ms);
  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 2 * DAY) return "Yesterday";
  return `${Math.floor(elapsed / DAY)} days ago`;
}
