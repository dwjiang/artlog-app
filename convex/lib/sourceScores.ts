import scores from "../../shared/sources/source-scores.json";

function bareHost(url: string): string | null {
  try {
    return new URL(url).hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

function matches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

// Museum shops repeat curatorial text on product pages; a T-shirt listing is not a source chip.
const MERCHANDISE = /^(?:shop|store|customprints|prints)\.|\/(?:shop|store|products?)(?:\/|$)/i;

// A source is admitted only when its domain scores above the threshold; excluded
// domains and unlisted domains (which take the default score) are dropped.
export function sourceScore(url: string): number | null {
  const host = bareHost(url);
  if (!host || scores.excluded.some((domain) => matches(host, domain))) {
    return null;
  }
  if (MERCHANDISE.test(`${host}${new URL(url).pathname}`)) return null;
  const listed = Object.entries(scores.domains).find(([domain]) => matches(host, domain));
  const score = listed ? listed[1] : scores.default;
  return score >= scores.threshold ? score : null;
}

export function admissibleDomains(): string[] {
  return Object.entries(scores.domains)
    .filter(([, score]) => score >= scores.threshold)
    .map(([domain]) => domain);
}
