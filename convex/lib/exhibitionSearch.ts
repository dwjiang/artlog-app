import type { TavilySearchResponse } from "./tavily";
import { websiteUrl } from "./collectionSiteProbe";
import type { SearchCandidate } from "./validators";
import { allowedVenueUrl } from "./venueFetch";

const MAX_PAGES = 3;
export const MAX_EXHIBITION_IMAGES = 6;
const NON_EXHIBITION = /^(?:shop|store|prints)\.|\/(?:shop|store|products?)(?:\/|$)/i;
const NON_IMAGE = /(?:cookie|pixel|beacon|analytics|\.svg(?:$|\?))/i;

export function exhibitionCandidates(response: TavilySearchResponse, hosts: string[]): SearchCandidate[] {
  const candidates: SearchCandidate[] = [];
  const visited = new Set<string>();
  for (const result of [...response.results].sort((a, b) => b.score - a.score)) {
    const page = allowedVenueUrl(result.url, hosts);
    if (!page || NON_EXHIBITION.test(page.host + page.pathname) || visited.has(page.href)) {
      continue;
    }
    visited.add(page.href);
    const images = result.images.flatMap((value) => {
      // Museum pages commonly serve their images from a separate CDN. Only per-result images
      // have a source association; confirmation still requires that image on the museum page.
      const image = websiteUrl(value);
      return image?.protocol === "https:" && !NON_IMAGE.test(image.pathname + image.search) ? [image.href] : [];
    });
    const imageUrls = [...new Set(images)].slice(0, MAX_EXHIBITION_IMAGES);
    if (!imageUrls.length) continue;
    candidates.push({
      sourceUrl: page.href,
      imageUrls,
      exhibition: {
        title: result.title.slice(0, 500),
        content: result.content.slice(0, 6000),
      },
    });
    if (candidates.length === MAX_PAGES) break;
  }
  return candidates;
}
