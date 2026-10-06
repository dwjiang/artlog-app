// Search rows use the catalog's 330-pixel Commons thumbnails; a page-wide picture asks Commons for a standard
// larger width. Other hosts serve one size.
const PAGE_WIDTH = "1280";

/** The catalog picture at a size that stays sharp across the screen's width. */
export function pageSizedImage(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "commons.wikimedia.org" || !parsed.searchParams.has("width")) return url;
    parsed.searchParams.set("width", PAGE_WIDTH);
    return parsed.toString();
  } catch {
    return url;
  }
}
