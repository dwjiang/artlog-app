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

// Verified owner sites are primary sources. Other domains must clear the configured score;
// exclusions and merchandise restrictions apply to both.
export function sourceScore(url: string, ownerHosts: string[] = []): number | null {
  const host = bareHost(url);
  if (!host || scores.excluded.some((domain) => matches(host, domain))) {
    return null;
  }
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  if (MERCHANDISE.test(`${host}${parsed.pathname}`)) return null;
  if (ownerHosts.some((domain) => matches(host, domain))) return 1;
  const listed = Object.entries(scores.domains).find(([domain]) => matches(host, domain));
  const score = listed ? listed[1] : scores.default;
  return score >= scores.threshold ? score : null;
}

export function admissibleDomains(ownerHosts: string[] = []): string[] {
  return [
    ...new Set([
      ...Object.entries(scores.domains)
        .filter(([, score]) => score >= scores.threshold)
        .map(([domain]) => domain),
      ...ownerHosts.filter((host) => sourceScore(`https://${host}`, ownerHosts) !== null),
    ]),
  ];
}
