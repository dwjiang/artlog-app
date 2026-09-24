import { reportBackendError } from "./observability";
import type { Doc } from "../_generated/dataModel";
import { extractPage, hasArtworkMetadata, type PageFields } from "./pageExtract";
import type { TavilySearchResponse } from "./tavily";
import {
  TITLE_MATCH_THRESHOLD,
  artistMentioned,
  exactTitle,
  jaccard,
  mentions,
  normalizeText,
  personMatches,
  titleMatches,
  titleQualifiersMatch,
} from "./textMatch";
import type {
  ImageCheck,
  LabelEvidence,
  LabelField,
  LabelFieldName,
  LabelFields,
  LabelFlow,
  LabelFlowDisplay,
} from "./validators";
import { allowedVenueUrl, fetchVenuePage, hostAllowed } from "./venueFetch";
import {
  collections,
  countries,
  creators,
  entityLabel,
  getEntities,
  isArtist,
  isPainting,
  searchEntities,
  type WikidataEntity,
} from "./wikidata";

export const FIELD_NAMES = [
  "title",
  "artist",
  "date",
  "accession",
  "medium",
  "creditLine",
] as const satisfies readonly LabelFieldName[];
export type LabelInput = Partial<Record<LabelFieldName, string>>;

// Fields verified against an authority are locked; `weak` and `ocr` stay editable.
export const LOCKING_EVIDENCE: ReadonlySet<LabelEvidence> = new Set([
  "accession",
  "qr",
  "wikidata",
  "tavily",
  "tavily+image",
]);
// The museum is the authority, so plausibility checks never downgrade its own statements.
export const MUSEUM_EVIDENCE: ReadonlySet<LabelEvidence> = new Set(["accession", "qr"]);
export const IMAGE_MATCH_COSINE = 0.85;
const MAX_IMAGE_URLS = 3;

export function displayLabelFlow(flow: LabelFlow): LabelFlowDisplay {
  const { rawOcr: _rawOcr, ...display } = flow;
  return display;
}

// Similarity alone never selects a work; the homography must hold as well.
export function imageCheckPasses(check: ImageCheck): boolean {
  return (
    Number.isFinite(check.cosine) && check.cosine >= IMAGE_MATCH_COSINE && check.cosine <= 1 && check.homographyValid
  );
}

export function labelField(value: string, evidence: LabelEvidence, confidence?: number): LabelField {
  return {
    value,
    evidence,
    locked: LOCKING_EVIDENCE.has(evidence),
    ...(confidence === undefined ? {} : { confidence }),
  };
}

export function withEvidence(field: LabelField, evidence: LabelEvidence): LabelField {
  return { ...field, evidence, locked: LOCKING_EVIDENCE.has(evidence) };
}

export function evidenceSummary(fields: LabelFields): LabelEvidence[] {
  const kinds = new Set<LabelEvidence>();
  for (const name of FIELD_NAMES) {
    const evidence = fields[name]?.evidence;
    if (evidence && LOCKING_EVIDENCE.has(evidence)) kinds.add(evidence);
  }
  return [...kinds];
}

export function trimInput(input: LabelInput): LabelInput {
  const trimmed: LabelInput = {};
  for (const name of FIELD_NAMES) {
    const value = input[name]?.trim();
    if (value) trimmed[name] = value;
  }
  return trimmed;
}

export type AccessionEvidence = { sourceUrl: string; fields: PageFields };

export async function verifyAccession(
  venue: Pick<Doc<"museums">, "accessionUrlPattern">,
  hosts: string[],
  input: LabelInput,
): Promise<AccessionEvidence | null> {
  if (!venue.accessionUrlPattern || !input.accession || (!input.title && !input.artist)) {
    return null;
  }
  let page;
  try {
    page = await fetchVenuePage(
      venue.accessionUrlPattern.replace("{accession}", encodeURIComponent(input.accession)),
      hosts,
    );
  } catch (error) {
    await reportBackendError(error, "label.accession");
    console.warn("Accession lookup unavailable", error);
    return null;
  }
  const extracted = extractPage(page.html);
  if (extracted.fields.accession && normalizeText(extracted.fields.accession) !== normalizeText(input.accession)) {
    return null;
  }
  const title = input.title;
  const titleOk =
    title !== undefined
    && titleQualifiersMatch(title, extracted.fields.title ?? "")
    && jaccard(title, extracted.fields.title ?? "") >= TITLE_MATCH_THRESHOLD;
  const artistOk =
    input.artist !== undefined
    && extracted.fields.artist !== undefined
    && personMatches(input.artist, extracted.fields.artist);
  if (!(titleOk || (title === undefined && artistOk))) return null;
  return { sourceUrl: page.url, fields: extracted.fields };
}

export type WikidataPair = { paintingId: string; artist: WikidataEntity };

export async function findWikidataPainting(title: string, artist: string): Promise<WikidataPair | null> {
  const hits = await searchEntities(title);
  if (!hits.length) return null;
  const entities = await getEntities(hits.map((hit) => hit.id));
  const paintings = hits.flatMap((hit) => {
    const entity = entities[hit.id];
    return entity && isPainting(entity) && titleMatches(title, entityLabel(entity) ?? "") ? [entity] : [];
  });
  const creatorIds = paintings.flatMap(creators);
  if (!creatorIds.length) return null;
  const creatorEntities = await getEntities(creatorIds);
  for (const painting of paintings) {
    for (const id of creators(painting)) {
      const creator = creatorEntities[id];
      const name = creator ? entityLabel(creator) : undefined;
      if (creator && name && isArtist(creator) && personMatches(artist, name)) {
        return { paintingId: painting.id, artist: creator };
      }
    }
  }
  return null;
}

export async function findArtist(name: string): Promise<WikidataEntity | null> {
  const hits = await searchEntities(name, 5);
  if (!hits.length) return null;
  const entities = await getEntities(hits.map((hit) => hit.id));
  for (const hit of hits) {
    const entity = entities[hit.id];
    if (entity && isArtist(entity) && personMatches(name, entityLabel(entity) ?? "")) {
      return entity;
    }
  }
  return null;
}

// Advisory only: `undefined` when Wikidata has no collection or country data to compare.
export async function venueCountryMatch(
  artist: WikidataEntity,
  venue: Pick<Doc<"museums">, "wikidataId"> | null,
): Promise<boolean | undefined> {
  const venueId = venue?.wikidataId;
  const artistCollections = collections(artist);
  if (!venueId || !artistCollections.length) return undefined;
  if (artistCollections.includes(venueId)) return true;
  const entities = await getEntities([venueId, ...artistCollections]);
  const venueEntity = entities[venueId];
  const venueCountries = venueEntity ? countries(venueEntity) : [];
  const known = artistCollections.flatMap((id) => (entities[id] ? countries(entities[id]) : []));
  if (!venueCountries.length || !known.length) return undefined;
  return known.some((country) => venueCountries.includes(country));
}

export type TavilyEvidence = { sourceUrl: string; imageUrls: string[] };
export type TavilyPair = { title: string; artist: string; accession?: string };

const OBJECT_PATH = /\/(?:art|artworks?|objects?|collections?|works?|paintings?)(?:\/|$)/i;
const NON_OBJECT =
  /^(?:shop|store|customprints|prints)\.|\/(?:shop|store|products?|audio|videos?|press|articles?|magazine|perspectives|exhibitions?|calendar|galleries|artists|catalogues|learn-about-art)(?:\/|$)/i;
const TRACKING = /(?:cookie|pixel|beacon|analytics|\/match\b|\/seg\b|\/iu3\b)/i;

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
}

// Images the phone may download: on the venue's own https hosts, never trackers or vector logos.
function artworkImageUrls(images: string[], pageUrl: string, hosts: string[]): string[] {
  const urls = images.flatMap((image) => {
    let url: URL | null;
    try {
      url = allowedVenueUrl(new URL(image, pageUrl).href, hosts);
    } catch {
      return [];
    }
    return url && !TRACKING.test(url.pathname + url.search) && !/\.svg$/i.test(url.pathname) ? [url.href] : [];
  });
  return [...new Set(urls)].slice(0, MAX_IMAGE_URLS);
}

// Find the pair in substantive museum content, prefer the canonical object page over
// shops, audio and essays, and never treat global image results as evidence for the object.
export async function selectTavilyEvidence(
  response: TavilySearchResponse,
  pair: TavilyPair,
  hosts: string[],
): Promise<TavilyEvidence | null> {
  const ranked = response.results
    .flatMap((result) => {
      let url: URL;
      try {
        url = new URL(result.url);
      } catch {
        return [];
      }
      if (url.protocol !== "https:" || !hostAllowed(url, hosts)) return [];
      const content = result.content.split(/\b(?:related|more)\s+(?:artworks?|works?|objects?)\b/i)[0];
      const haystack = `${result.title}\n${content}`;
      const titleInTitle = titleMatches(pair.title, result.title);
      if (!titleInTitle && !mentions(content, pair.title)) return [];
      if (!artistMentioned(haystack, pair.artist)) return [];
      if (!titleQualifiersMatch(pair.title, result.title)) return [];
      const accessionHit = pair.accession !== undefined && mentions(`${result.url} ${haystack}`, pair.accession);
      const canonical = OBJECT_PATH.test(url.pathname) && !NON_OBJECT.test(url.host + url.pathname);
      const key = [
        Number(accessionHit),
        Number(exactTitle(pair.title, result.title)),
        Number(titleInTitle),
        Number(canonical),
        result.score,
      ];
      return [{ result, key }];
    })
    .sort((a, b) => compareKeys(a.key, b.key));
  for (const { result } of ranked) {
    const evidence: TavilyEvidence = { sourceUrl: result.url, imageUrls: [] };
    try {
      // Search image arrays include related works. Only the artwork page can bind an image to its identity.
      const page = await fetchVenuePage(evidence.sourceUrl, hosts);
      const extracted = extractPage(page.html);
      const { title, artist, accession } = extracted.fields;
      if (
        (title && (!titleQualifiersMatch(pair.title, title) || jaccard(pair.title, title) < TITLE_MATCH_THRESHOLD))
        || (artist && !personMatches(pair.artist, artist))
        || (pair.accession && accession && normalizeText(pair.accession) !== normalizeText(accession))
      ) {
        continue;
      }
      if (hasArtworkMetadata(extracted)) {
        evidence.imageUrls = artworkImageUrls(extracted.imageUrls, page.url, hosts);
      }
    } catch (error) {
      await reportBackendError(error, "label.imageMetadata");
      console.warn("Artwork image metadata unavailable; keeping text evidence only", error);
    }
    return evidence;
  }
  return null;
}
