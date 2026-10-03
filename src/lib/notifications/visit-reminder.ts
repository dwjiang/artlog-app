export const VISIT_REMINDER_DELAY_MS = 3 * 60 * 60_000;
const LATEST_HOUR = 22;

/**
 * When to ask about a visit that is still open: three hours after its last save. None late at night, when the person
 * has surely left; the next launch after the museum day closes the visit and offers the wrap-up on Home instead.
 */
export function visitReminderAt(lastActivity: number): number | undefined {
  const at = lastActivity + VISIT_REMINDER_DELAY_MS;
  const fires = new Date(at);
  if (fires.toDateString() !== new Date(lastActivity).toDateString() || fires.getHours() >= LATEST_HOUR) return;
  return at;
}
