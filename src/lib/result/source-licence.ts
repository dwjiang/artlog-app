export type SourceLicence = { publisher: string; name: string; url: string };

const WIKIPEDIA = {
  publisher: "Wikipedia",
  name: "CC BY-SA 4.0",
  url: "https://creativecommons.org/licenses/by-sa/4.0/",
};
const ART_INSTITUTE = {
  publisher: "the Art Institute of Chicago",
  name: "CC BY 4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
};

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

/** Each licence the cited pages use, once, in order of first citation. */
export function sourceLicences(urls: string[]): SourceLicence[] {
  const licences = urls.map(sourceLicence).filter((licence) => licence !== undefined);
  return [...new Set(licences)];
}
