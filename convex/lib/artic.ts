import { ConvexError } from "convex/values";

import { decodeEntities } from "./pageExtract";
import { fetchText, userAgent } from "./politeFetch";

const TIMEOUT_MS = 8000;
const MAX_BYTES = 1024 * 1024;

// Inline tags go without a space so a quoted sentence reads as it does on the page.
function paragraphs(html: string): string {
  return decodeEntities(html.replaceAll(/<\/p>|<br\s*\/?>/gi, "\n").replaceAll(/<[^>]+>/g, ""))
    .split("\n")
    .map((line) => line.replaceAll(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// Chicago's curatorial text (CC BY 4.0) from its public API; the collection website refuses our fetcher.
// Empty when the artwork has none or the id is unknown.
export async function articDescription(id: string): Promise<string> {
  let page;
  try {
    page = await fetchText(
      `https://api.artic.edu/api/v1/artworks/${encodeURIComponent(id)}?fields=description,short_description`,
      { headers: { "AIC-User-Agent": userAgent(), "User-Agent": userAgent(), Accept: "application/json" } },
      { timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES },
    );
  } catch {
    throw new ConvexError({ code: "artic_error", reason: "fetch_failed" });
  }
  if (page.status === 404) return "";
  if (page.status !== 200) {
    throw new ConvexError({ code: "artic_error", reason: `http_${page.status}` });
  }
  let data: Record<string, unknown> | undefined;
  try {
    data = (JSON.parse(page.body) as { data?: Record<string, unknown> }).data;
  } catch {
    throw new ConvexError({ code: "artic_error", reason: "bad_json" });
  }
  return [data?.description, data?.short_description]
    .flatMap((html) => (typeof html === "string" ? [paragraphs(html)] : []))
    .filter(Boolean)
    .join("\n");
}
