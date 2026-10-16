export type SourceLicence = { name: string; url: string };

const WIKIPEDIA = { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" };
const ART_INSTITUTE = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" };

/** The open licence a cited page's text is reused under, for publishers whose licence requires naming it. */
export function sourceLicence(url: string): SourceLicence | undefined {
  let page: URL;
  try {
    page = new URL(url);
  } catch {
    return undefined;
  }
  const host = page.hostname.toLowerCase();
  if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return WIKIPEDIA;
  // Only the artwork descriptions are CC BY; the museum's other pages keep their own terms.
  if ((host === "artic.edu" || host === "www.artic.edu") && page.pathname.startsWith("/artworks/")) {
    return ART_INSTITUTE;
  }
  return undefined;
}
