/** The narrowest iPhone width: room for one copy of a phone grid. */
const PANE_WIDTH = 320;

/**
 * Columns for a grid that shows `phoneColumns` across a phone: one at the largest text sizes, and on wider screens
 * (landscape, the open iPhone Duo) the phone grid repeated side by side, so tiles stay near their phone size and the
 * count stays even across a fold.
 */
export function gridColumns(phoneColumns: number, width: number, fontScale: number) {
  if (fontScale > 1.4) return 1;
  return phoneColumns * Math.max(1, Math.floor(width / PANE_WIDTH));
}
