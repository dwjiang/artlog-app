export const ARTIST_LINE_SEPARATOR = " · ";

/** An artwork's artist and date as every screen shows them, "Vincent van Gogh · 1889"; either may be missing. */
export function artistLine(artist?: string | null, date?: string | null): string {
  return [artist?.trim(), date?.trim()].filter(Boolean).join(ARTIST_LINE_SEPARATOR);
}
