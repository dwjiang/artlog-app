import { ConvexError } from "convex/values";

import { normalizePassage } from "../../shared/audio/guide";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { wikidataScore, type SourceDoc } from "./docentPrompts";
import { reportBackendError } from "./observability";
import { pageText } from "./pageExtract";
import { admissibleDomains, sourceScore } from "./sourceScores";
import { searchWithCredit } from "./tavilySpend";
import { fetchVenuePage, venueHosts } from "./venueFetch";
import {
  entityLabel,
  getEntities,
  getEntity,
  itemValues,
  monolingualValues,
  quantityValues,
  stringValues,
  yearValues,
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

function sourceIdentity(value: string): string {
  const url = new URL(value);
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

// The owner's collection page, Wikidata, and score-filtered search results. Fetch errors
// are counted so the caller can retry later instead of caching an empty sheet.
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
  if (input.artwork.wikidataId) {
    try {
      const entity = await getEntity(input.artwork.wikidataId);
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
  const response = await searchWithCredit(ctx, {
    query: `"${input.artwork.title.replaceAll('"', "")}" ${input.artwork.artist} ${input.owner?.name ?? "painting"}`,
    includeDomains: admissibleDomains(),
    maxResults: SEARCH_RESULTS,
    includeRawContent: true,
  });
  if (!response) failures++;
  const anchors = new Set([
    ...(input.pageUrl ? [sourceIdentity(input.pageUrl)] : []),
    ...(input.artwork.wikidataId ? [sourceIdentity(`https://www.wikidata.org/wiki/${input.artwork.wikidataId}`)] : []),
  ]);
  for (const result of response?.results ?? []) {
    const score = sourceScore(result.url);
    const content = result.rawContent?.trim() || result.content.trim();
    if (score === null || !content) continue;
    // A trusted domain can describe another work with the same title; require the known identity.
    if (anchors.size > 0 && !anchors.has(sourceIdentity(result.url)) && !linksToArtwork(content, result.url, anchors)) {
      continue;
    }
    const text = `${result.title}\n${plainMarkdown(content)}`.trim().slice(0, MAX_SOURCE_CHARS);
    // Search can return the owner's page again, often under a language or tracking parameter. Keep
    // one source per page: the longer text, under the first URL, label and score.
    const identity = sourceIdentity(result.url);
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
