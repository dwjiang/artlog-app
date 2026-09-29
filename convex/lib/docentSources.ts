import { ConvexError } from "convex/values";

import { normalizePassage } from "../../shared/audio/guide";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { articDescription } from "./artic";
import { wikidataScore, type SourceDoc } from "./docentPrompts";
import { reportBackendError } from "./observability";
import { pageText } from "./pageExtract";
import { admissibleDomains, sourceScore } from "./sourceScores";
import { searchWithCredit } from "./tavilySpend";
import { fetchVenuePage, venueHosts } from "./venueFetch";
import {
  entityLabel,
  findEntityByStatement,
  getEntities,
  getEntity,
  itemValues,
  monolingualValues,
  quantityValues,
  stringValues,
  yearValues,
  wikipediaArticle,
  type WikidataEntity,
} from "./wikidata";

const MIN_PAGE_CHARS = 80;
const SEARCH_RESULTS = 8;
const MAX_SOURCE_CHARS = 24_000;
// One owner page plus eight full search results can run past fifty thousand tokens; the fact sheet
// caps at twenty facts, so the best-scored sources fill a fixed budget and the rest are cut.
const TOTAL_SOURCE_CHARS = 40_000;
// Search pages quote one another: an article repeats the museum's description, a press page its
// collection entry. Lines shorter than this stay everywhere; headings and label-value rows recur by nature.
const MIN_PASSAGE_CHARS = 80;

const SUMMARY_PROPERTIES: {
  property: string;
  name: string;
  kind: "item" | "time" | "string" | "monolingual" | "quantity";
}[] = [
  { property: "P1476", name: "Title", kind: "monolingual" },
  { property: "P170", name: "Creator", kind: "item" },
  { property: "P571", name: "Inception", kind: "time" },
  { property: "P186", name: "Material", kind: "item" },
  { property: "P2048", name: "Height", kind: "quantity" },
  { property: "P2049", name: "Width", kind: "quantity" },
  { property: "P135", name: "Movement", kind: "item" },
  { property: "P136", name: "Genre", kind: "item" },
  { property: "P180", name: "Depicts", kind: "item" },
  { property: "P276", name: "Location", kind: "item" },
  { property: "P195", name: "Collection", kind: "item" },
  { property: "P217", name: "Inventory number", kind: "string" },
  { property: "P6216", name: "Copyright status", kind: "item" },
];
const UNITS: Record<string, string> = {
  Q174728: "cm",
  Q11573: "m",
  Q174789: "mm",
  Q218593: "in",
};
const ARTIC_ID = "P4610";
// Museums whose collection pages search returns, by the Wikidata property that records their object ids.
const COLLECTIONS = [
  {
    property: "P3634",
    page: (id: string) => `https://www.metmuseum.org/art/collection/search/${id}`,
    identity: /^metmuseum\.org\/art\/collection\/search\/(\d+)$/,
  },
  {
    property: ARTIC_ID,
    page: (id: string) => `https://www.artic.edu/artworks/${id}`,
    identity: /^artic\.edu\/artworks\/(\d+)$/,
  },
];

export type SourceInput = {
  artwork: Pick<Doc<"artworks">, "title" | "artist" | "wikidataId">;
  owner: Pick<Doc<"museums">, "name" | "website" | "collectionSiteUrl"> | null;
  pageUrl?: string;
};

export type GatheredSources = { sources: SourceDoc[]; failures: number };

function bareHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

export async function wikidataSummary(entity: WikidataEntity): Promise<string> {
  const itemIds = SUMMARY_PROPERTIES.filter(({ kind }) => kind === "item").flatMap(({ property }) =>
    itemValues(entity, property),
  );
  const labels = itemIds.length > 0 ? await getEntities(itemIds, "labels") : {};
  const lines: string[] = [];
  const label = entityLabel(entity);
  if (label) lines.push(`Label: ${label}`);
  for (const { property, name, kind } of SUMMARY_PROPERTIES) {
    let values: string[] = [];
    if (kind === "item") {
      values = itemValues(entity, property).flatMap((id) => (labels[id] ? [entityLabel(labels[id]) ?? id] : []));
    } else if (kind === "time") {
      values = yearValues(entity, property).map(String);
    } else if (kind === "string") {
      values = stringValues(entity, property);
    } else if (kind === "monolingual") {
      values = monolingualValues(entity, property);
    } else {
      values = quantityValues(entity, property).map(
        ({ amount, unit }) => `${amount}${UNITS[unit] ? ` ${UNITS[unit]}` : ""}`,
      );
    }
    if (values.length > 0) {
      lines.push(`${name}: ${[...new Set(values)].join(", ")}`);
    }
  }
  return lines.join("\n");
}

function collectionPages(entity: WikidataEntity): string[] {
  return COLLECTIONS.flatMap(({ property, page }) => stringValues(entity, property).map(page));
}

function collectionObject(url: string): { property: string; id: string } | null {
  for (const { property, identity } of COLLECTIONS) {
    const id = identity.exec(sourceIdentity(url))?.[1];
    if (id) return { property, id };
  }
  return null;
}

const wikipediaUrl = (title: string) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;

function sourceIdentity(value: string): string {
  const url = new URL(value);
  if (bareHost(value) === "artic.edu") {
    // Chicago's numeric collection URLs and title-suffixed URLs identify the same object.
    const objectId = url.pathname.match(/^\/artworks\/(\d+)(?:\/[^/]+)?\/?$/)?.[1];
    if (objectId) return `artic.edu/artworks/${objectId}`;
  }
  if (bareHost(value) === "metmuseum.org") {
    const objectId =
      url.pathname.match(/^\/(?:[a-z]{2}\/)?art\/collection\/search\/(\d+)\/?$/)?.[1]
      ?? (url.pathname === "/exhibitions/view" ? url.searchParams.get("oid") : null);
    if (objectId && /^\d+$/.test(objectId)) {
      return `metmuseum.org/art/collection/search/${objectId}`;
    }
  }
  const query = [...url.searchParams.entries()]
    .filter(([key]) => !key.startsWith("utm_") && !["lang", "fbclid", "gclid"].includes(key))
    .sort((a, b) => {
      const [left, right] = [a.join(","), b.join(",")];
      return left < right ? -1 : left > right ? 1 : 0;
    });
  const suffix = new URLSearchParams(query).toString();
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Legacy museum links carry non-UTF-8 escapes; the raw path still identifies the page.
  }
  return `${bareHost(value)}${path.replaceAll(" ", "_").replace(/\/$/, "")}${suffix ? `?${suffix}` : ""}`;
}

function linksToArtwork(text: string, pageUrl: string, anchors: Set<string>): boolean {
  if (
    !/\/(?:essays|perspectives|exhibitions|press|press-releases|stories|articles|blog)\//.test(
      new URL(pageUrl).pathname,
    )
  ) {
    return false;
  }
  return [...text.matchAll(/\]\(([^\s)]+)\)/g)].some((match) => {
    try {
      return anchors.has(sourceIdentity(new URL(match[1], pageUrl).href));
    } catch {
      return false;
    }
  });
}

// Search pages arrive as markdown so their links can identify the artwork. The model gets plain
// prose: facts must be copied verbatim, and a copy that drops `*` or `[text](url)` would not match.
function plainMarkdown(text: string): string {
  return text
    .replaceAll(/!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, "")
    .replaceAll(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    .replaceAll(/^#{1,6}[ \t]+/gm, "")
    .replaceAll(/(\*{1,3})(?=\S)([^*\n]+?)(?<=\S)\1/g, "$2")
    .replaceAll(/(?<![\w_])(_{1,3})(?=\S)([^_\n]+?)(?<=\S)\1(?![\w_])/g, "$2")
    .replaceAll(/\n{3,}/g, "\n\n");
}

// Sources arrive best first. A passage stays only in the first source that carries it, and the text
// sent stops at the budget; a fact is checked against the text the model saw, so cuts are safe.
export function trimSources(sources: SourceDoc[]): SourceDoc[] {
  const seen = new Set<string>();
  const trimmed: SourceDoc[] = [];
  let remaining = TOTAL_SOURCE_CHARS;
  for (const source of sources) {
    const lines = source.text.split("\n").filter((line) => {
      const key = normalizePassage(line);
      if (key.length < MIN_PASSAGE_CHARS) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const text = lines.join("\n").trim().slice(0, Math.max(0, remaining));
    if (!text) continue;
    remaining -= text.length;
    trimmed.push({ ...source, text });
  }
  return trimmed;
}

// The owner's collection page, Chicago's API text, Wikidata, the work's English Wikipedia article, and
// score-filtered search results. Fetch errors are counted so the caller can retry later instead of caching an empty sheet.
export async function gatherSources(ctx: ActionCtx, input: SourceInput): Promise<GatheredSources> {
  const sources: SourceDoc[] = [];
  let failures = 0;
  if (input.pageUrl && input.owner) {
    try {
      const pageUrl = new URL(input.pageUrl);
      if (pageUrl.protocol === "http:") pageUrl.protocol = "https:";
      const page = await fetchVenuePage(pageUrl.href, venueHosts(input.owner));
      const text = pageText(page.html, MAX_SOURCE_CHARS);
      if (text.length >= MIN_PAGE_CHARS) {
        sources.push({
          url: page.url,
          label: input.owner.name,
          score: 1,
          text,
        });
      }
    } catch (error) {
      if (!(error instanceof ConvexError && error.data.code === "qr_host_not_allowed")) {
        failures++;
      }
      // Museum bot protection is an expected refusal; the search sources below remain usable.
      if (
        !(error instanceof ConvexError && error.data.code === "page_unavailable" && error.data.reason === "http_403")
      ) {
        await reportBackendError(error, "docent.ownerPage");
      }
      console.warn("Owner page unavailable for the fact sheet", error);
    }
  }
  const ownerObject = input.pageUrl ? collectionObject(input.pageUrl) : null;
  let { wikidataId } = input.artwork;
  // Works imported from the Met or Chicago carry no Wikidata id; their object id finds the item.
  if (!wikidataId && ownerObject) {
    try {
      wikidataId = (await findEntityByStatement(ownerObject.property, ownerObject.id)) ?? undefined;
    } catch (error) {
      failures++;
      await reportBackendError(error, "docent.wikidata");
      console.warn("Wikidata unavailable for the fact sheet", error);
    }
  }
  const wikidataPage = wikidataId ? sourceIdentity(`https://www.wikidata.org/wiki/${wikidataId}`) : undefined;
  const anchors = new Set([
    ...(input.pageUrl ? [sourceIdentity(input.pageUrl)] : []),
    ...(wikidataPage ? [wikidataPage] : []),
  ]);
  let article: string | undefined;
  let articId = ownerObject?.property === ARTIC_ID ? ownerObject.id : undefined;
  if (wikidataId) {
    try {
      const entity = await getEntity(wikidataId, "labels|claims|sitelinks");
      article = entity?.sitelinks?.enwiki?.title;
      articId ??= entity ? stringValues(entity, ARTIC_ID).find((id) => /^\d+$/.test(id)) : undefined;
      for (const page of entity ? collectionPages(entity) : []) anchors.add(sourceIdentity(page));
      const text = entity ? await wikidataSummary(entity) : "";
      if (entity && text) {
        sources.push({
          url: `https://www.wikidata.org/wiki/${entity.id}`,
          label: "Wikidata",
          score: wikidataScore(),
          text,
        });
      }
    } catch (error) {
      failures++;
      await reportBackendError(error, "docent.wikidata");
      console.warn("Wikidata unavailable for the fact sheet", error);
    }
  }
  // Search often misses a work's own article, so the one Wikidata links is read directly.
  let articlePage: string | undefined;
  if (article) {
    const url = wikipediaUrl(article);
    anchors.add(sourceIdentity(url));
    try {
      const text = await wikipediaArticle(article);
      if (text) {
        articlePage = sourceIdentity(url);
        sources.push({ url, label: "Wikipedia", score: sourceScore(url) ?? 0, text: text.slice(0, MAX_SOURCE_CHARS) });
      }
    } catch (error) {
      failures++;
      await reportBackendError(error, "docent.wikipedia");
      console.warn("Wikipedia unavailable for the fact sheet", error);
    }
  }
  if (articId) {
    const url = `https://www.artic.edu/artworks/${articId}`;
    try {
      const text = await articDescription(articId);
      if (text) {
        sources.push({
          url,
          label: "Art Institute of Chicago",
          score: sourceScore(url) ?? 0,
          text: text.slice(0, MAX_SOURCE_CHARS),
        });
      }
    } catch (error) {
      failures++;
      await reportBackendError(error, "docent.artic");
      console.warn("Art Institute API unavailable for the fact sheet", error);
    }
  }
  const response = await searchWithCredit(ctx, {
    query: `"${input.artwork.title.replaceAll('"', "")}" ${input.artwork.artist} ${input.owner?.name ?? "painting"}`,
    includeDomains: admissibleDomains(),
    maxResults: SEARCH_RESULTS,
    includeRawContent: true,
  });
  if (!response) failures++;
  for (const result of response?.results ?? []) {
    const score = sourceScore(result.url);
    const content = result.rawContent?.trim() || result.content.trim();
    if (score === null || !content) continue;
    const identity = sourceIdentity(result.url);
    // Wikidata's page is statement tables no fact can quote verbatim; the summary above stands for it.
    // A scraped copy of the article read above adds only citation links and page chrome.
    if (identity === wikidataPage || identity === articlePage) continue;
    // A trusted domain can describe another work with the same title; require the known identity.
    if (anchors.size > 0 && !anchors.has(identity) && !linksToArtwork(content, result.url, anchors)) {
      continue;
    }
    const text = `${result.title}\n${plainMarkdown(content)}`.trim().slice(0, MAX_SOURCE_CHARS);
    // Search can return the owner's page again, often under a language or tracking parameter. Keep
    // one source per page: the longer text, under the first URL, label and score.
    const existing = sources.find((source) => sourceIdentity(source.url) === identity);
    if (!existing) {
      sources.push({
        url: result.url,
        label: bareHost(result.url),
        score,
        text,
      });
    } else if (text.length > existing.text.length) {
      existing.text = text;
    }
  }
  return { sources: trimSources(sources.sort((a, b) => b.score - a.score)), failures };
}
