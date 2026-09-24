import { ConvexError } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { websiteUrl } from "./collectionSiteProbe";
import { fetchText, userAgent } from "./politeFetch";

const MAX_PAGE_BYTES = 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

export type VenueSites = Pick<Doc<"museums">, "website" | "collectionSiteUrl">;

function bareHost(url: URL): string {
  return url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

// Hosts the server may fetch on a device's behalf: only the venue's own sites, never a host taken
// from a QR code or an accession pattern.
export function venueHosts(venue: VenueSites): string[] {
  const hosts = new Set<string>();
  for (const value of [venue.website, venue.collectionSiteUrl]) {
    const url = value ? websiteUrl(value) : null;
    if (url) hosts.add(bareHost(url));
  }
  return [...hosts];
}

export function hostAllowed(url: URL, hosts: string[]): boolean {
  const host = bareHost(url);
  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function allowedVenueUrl(value: string, hosts: string[]): URL | null {
  const url = websiteUrl(value);
  return url?.protocol === "https:" && hostAllowed(url, hosts) ? url : null;
}

export type VenuePage = { url: string; html: string };

function unavailable(reason: string): ConvexError<{ code: string; reason: string }> {
  return new ConvexError({ code: "page_unavailable", reason });
}

export async function fetchVenuePage(value: string, hosts: string[]): Promise<VenuePage> {
  let url = allowedVenueUrl(value, hosts);
  if (!url) throw new ConvexError({ code: "qr_host_not_allowed" });
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let page;
    try {
      page = await fetchText(
        url.href,
        {
          redirect: "manual",
          headers: {
            "User-Agent": userAgent(),
            Accept: "text/html, application/xhtml+xml;q=0.9",
          },
        },
        { timeoutMs: TIMEOUT_MS, maxBytes: MAX_PAGE_BYTES },
      );
    } catch {
      throw unavailable("fetch_failed");
    }
    if (page.status >= 300 && page.status < 400) {
      const location = page.headers.get("location");
      let next: URL | null = null;
      try {
        next = location ? allowedVenueUrl(new URL(location, url).href, hosts) : null;
      } catch {
        next = null;
      }
      if (!next) throw unavailable("redirect_off_host");
      url = next;
      continue;
    }
    if (page.status < 200 || page.status >= 300) {
      throw unavailable(`http_${page.status}`);
    }
    return { url: url.href, html: page.body };
  }
  throw unavailable("too_many_redirects");
}
