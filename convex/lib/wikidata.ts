import { ConvexError } from "convex/values";

import { fetchText, userAgent } from "./politeFetch";

const API = "https://www.wikidata.org/w/api.php";
const TIMEOUT_MS = 8000;
// Prolific artists carry hundreds of claims; Monet's entity alone is several megabytes.
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_IDS = 50;

export const PAINTING = "Q3305213";
export const ARTIST_OCCUPATIONS = ["Q1028181", "Q483501", "Q3391743"];
const INSTANCE_OF = "P31";
const CREATOR = "P170";
const OCCUPATION = "P106";
const BIRTH = "P569";
const DEATH = "P570";
const IN_COLLECTIONS = "P6379";
const COUNTRY = "P17";

type Claim = {
  rank?: string;
  references?: { snaks?: Record<string, { datavalue?: { value?: unknown } }[]> }[];
  mainsnak?: {
    snaktype?: string;
    datavalue?: { type?: string; value?: unknown };
  };
};

export type WikidataEntity = {
  id: string;
  missing?: string;
  labels?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
  claims?: Record<string, Claim[]>;
  sitelinks?: Record<string, { title: string }>;
};

export type SearchHit = { id: string; label?: string; description?: string };

async function call(params: Record<string, string>, api = API): Promise<unknown> {
  const url = `${api}?${new URLSearchParams({ ...params, format: "json" })}`;
  let page;
  try {
    page = await fetchText(
      url,
      { headers: { "User-Agent": userAgent(), Accept: "application/json" } },
      {
        timeoutMs: TIMEOUT_MS,
        maxBytes: MAX_BYTES,
      },
    );
  } catch {
    throw new ConvexError({ code: "wikidata_error", reason: "fetch_failed" });
  }
  if (page.status !== 200) {
    throw new ConvexError({
      code: "wikidata_error",
      reason: `http_${page.status}`,
    });
  }
  let json: unknown;
  try {
    json = JSON.parse(page.body);
  } catch {
    throw new ConvexError({ code: "wikidata_error", reason: "bad_json" });
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new ConvexError({ code: "wikidata_error", reason: "bad_response" });
  }
  if ("error" in json || "errors" in json) {
    throw new ConvexError({ code: "wikidata_error", reason: "api_error" });
  }
  return json;
}

export async function searchEntities(term: string, limit = 10): Promise<SearchHit[]> {
  const json = (await call({
    action: "wbsearchentities",
    search: term,
    language: "en",
    type: "item",
    limit: String(limit),
  })) as { search?: unknown };
  if (!Array.isArray(json.search)) return [];
  return json.search.flatMap((hit: unknown) => {
    if (!hit || typeof hit !== "object" || typeof (hit as SearchHit).id !== "string") {
      return [];
    }
    const { id, label, description } = hit as SearchHit;
    return [{ id, label, description }];
  });
}

export async function getEntities(
  ids: string[],
  props = "labels|claims",
  languages: string[] | "all" = ["en"],
  sitelinks: "languages" | "all" = "languages",
): Promise<Record<string, WikidataEntity>> {
  const unique = [...new Set(ids)];
  const entities: Record<string, WikidataEntity> = {};
  for (let offset = 0; offset < unique.length; offset += MAX_IDS) {
    const json = (await call({
      action: "wbgetentities",
      ids: unique.slice(offset, offset + MAX_IDS).join("|"),
      props,
      ...(languages !== "all" && { languages: languages.join("|") }),
      ...(sitelinks === "languages"
        && languages !== "all" && { sitefilter: languages.map((language) => `${language}wiki`).join("|") }),
    })) as { entities?: Record<string, WikidataEntity> };
    for (const [id, entity] of Object.entries(json.entities ?? {})) {
      if (entity && typeof entity === "object" && entity.missing === undefined) {
        entities[id] = { ...entity, id };
      }
    }
  }
  return entities;
}

export async function getEntity(
  id: string,
  props?: string,
  languages?: string[],
  sitelinks?: "languages" | "all",
): Promise<WikidataEntity | null> {
  return (await getEntities([id], props, languages, sitelinks))[id] ?? null;
}

// The item that carries this identifier, when exactly one does.
export async function findEntityByStatement(property: string, value: string): Promise<string | null> {
  const json = (await call({
    action: "query",
    list: "search",
    srsearch: `haswbstatement:${property}=${value}`,
    srlimit: "2",
  })) as { query?: { search?: { title?: unknown }[] } };
  const hits = json.query?.search ?? [];
  return hits.length === 1 && typeof hits[0].title === "string" ? hits[0].title : null;
}

function wikipediaApi(language: string): string {
  if (!/^[a-z]{2,3}(?:-[a-z0-9]+)*$/.test(language)) {
    throw new ConvexError({ code: "wikidata_error", reason: "invalid_language" });
  }
  return `https://${language}.wikipedia.org/w/api.php`;
}

// Plain text keeps the article's sentences quotable; empty when there is no such article.
export async function wikipediaArticle(title: string, language = "en"): Promise<string> {
  const json = (await call(
    {
      action: "query",
      prop: "extracts",
      explaintext: "1",
      exsectionformat: "plain",
      redirects: "1",
      titles: title,
      formatversion: "2",
    },
    wikipediaApi(language),
  )) as { query?: { pages?: { extract?: unknown }[] } };
  const extract = json.query?.pages?.[0]?.extract;
  return typeof extract === "string" ? extract.trim() : "";
}

// Resolves each requested title through MediaWiki's normalization and redirects to the page the API answered with.
function pagesByRequest<Page extends { title?: unknown }>(
  titles: string[],
  query: { normalized?: unknown; redirects?: unknown; pages?: unknown } | undefined,
): Map<string, Page> {
  const renames = new Map<string, string>();
  for (const list of [query?.normalized, query?.redirects]) {
    for (const entry of Array.isArray(list) ? list : []) {
      const { from, to } = entry as { from?: unknown; to?: unknown };
      if (typeof from === "string" && typeof to === "string") renames.set(from, to);
    }
  }
  const pages = new Map<string, Page>();
  for (const page of Array.isArray(query?.pages) ? (query.pages as Page[]) : []) {
    if (typeof page.title === "string") pages.set(page.title, page);
  }
  const resolved = new Map<string, Page>();
  for (const title of titles) {
    const normalized = renames.get(title) ?? title;
    const page = pages.get(renames.get(normalized) ?? normalized);
    if (page) resolved.set(title, page);
  }
  return resolved;
}

/** Each article's freely licensed lead image as a Commons file name, keyed by the requested title. */
export async function wikipediaLeadImages(titles: string[], language: string): Promise<Map<string, string>> {
  const json = (await call(
    {
      action: "query",
      prop: "pageimages",
      piprop: "name",
      pilicense: "free",
      pilimit: String(titles.length),
      redirects: "1",
      titles: titles.join("|"),
      formatversion: "2",
    },
    wikipediaApi(language),
  )) as { query?: { pages?: { title?: unknown; pageimage?: unknown }[] } };
  const images = new Map<string, string>();
  for (const [title, page] of pagesByRequest<{ title?: unknown; pageimage?: unknown }>(titles, json.query)) {
    if (typeof page.pageimage === "string") images.set(title, page.pageimage);
  }
  return images;
}

export function entityLabel(entity: WikidataEntity, language = "en"): string | undefined {
  return entity.labels?.[language]?.value;
}

/** Every label and alias the entity carries, in any language. */
export function entityNames(entity: WikidataEntity): string[] {
  const labels = Object.values(entity.labels ?? {}).map((label) => label.value);
  const aliases = Object.values(entity.aliases ?? {}).flatMap((list) => list.map((alias) => alias.value));
  return [...new Set([...labels, ...aliases])];
}

function values(entity: WikidataEntity, property: string): unknown[] {
  return (entity.claims?.[property] ?? []).flatMap((claim) => {
    const snak = claim.mainsnak;
    return snak?.snaktype === "value" || snak?.datavalue ? [snak.datavalue?.value] : [];
  });
}

export function itemValues(entity: WikidataEntity, property: string): string[] {
  return values(entity, property).flatMap((value) => {
    const id = value && typeof value === "object" ? (value as { id?: unknown }).id : undefined;
    return typeof id === "string" ? [id] : [];
  });
}

export function stringValues(entity: WikidataEntity, property: string): string[] {
  return values(entity, property).flatMap((value) => (typeof value === "string" ? [value] : []));
}

export function monolingualValues(entity: WikidataEntity, property: string): string[] {
  return values(entity, property).flatMap((value) => {
    const text = value && typeof value === "object" ? (value as { text?: unknown }).text : undefined;
    return typeof text === "string" ? [text] : [];
  });
}

export type Quantity = { amount: number; unit: string };

export function quantityValues(entity: WikidataEntity, property: string): Quantity[] {
  return values(entity, property).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const { amount, unit } = value as { amount?: unknown; unit?: unknown };
    const parsed = typeof amount === "string" ? Number(amount) : NaN;
    return Number.isFinite(parsed)
      ? [
          {
            amount: parsed,
            unit: typeof unit === "string" ? (unit.split("/").pop() ?? "") : "",
          },
        ]
      : [];
  });
}

export function yearValues(entity: WikidataEntity, property: string): number[] {
  return values(entity, property).flatMap((value) => {
    const time = value && typeof value === "object" ? (value as { time?: unknown }).time : undefined;
    const match = typeof time === "string" ? /^([+-])(\d{1,16})-/.exec(time) : null;
    return match ? [Number(match[2]) * (match[1] === "-" ? -1 : 1)] : [];
  });
}

export function isPainting(entity: WikidataEntity): boolean {
  return itemValues(entity, INSTANCE_OF).includes(PAINTING);
}

export function creators(entity: WikidataEntity): string[] {
  return [...new Set(itemValues(entity, CREATOR))];
}

export function isArtist(entity: WikidataEntity): boolean {
  return itemValues(entity, OCCUPATION).some((occupation) => ARTIST_OCCUPATIONS.includes(occupation));
}

export type Lifespan = { birth?: number; death?: number };

export function lifespan(entity: WikidataEntity): Lifespan {
  return {
    birth: yearValues(entity, BIRTH)[0],
    death: yearValues(entity, DEATH)[0],
  };
}

export function collections(entity: WikidataEntity): string[] {
  return [...new Set(itemValues(entity, IN_COLLECTIONS))];
}

export function countries(entity: WikidataEntity): string[] {
  return [...new Set(itemValues(entity, COUNTRY))];
}

export async function commonsFileHtml(file: string): Promise<string> {
  const json = (await call(
    { action: "parse", page: `File:${file}`, prop: "text", redirects: "1", uselang: "en" },
    "https://commons.wikimedia.org/w/api.php",
  )) as { parse?: { text?: { "*"?: string } } };
  const html = json.parse?.text?.["*"];
  if (typeof html !== "string") throw new ConvexError({ code: "wikidata_error", reason: "bad_commons_response" });
  return html;
}

export type CommonsImage = {
  /** The file's current name, after Commons' redirects. */
  file: string;
  mime: string;
  width: number;
  /** HTML, as Commons renders the file page's author field. */
  artist?: string;
  license?: string;
  attributionRequired: boolean;
};

type ImagePage = {
  title?: unknown;
  imageinfo?: { mime?: unknown; width?: unknown; extmetadata?: Record<string, { value?: unknown } | undefined> }[];
};

/** Each Commons file's format, size and licensing, keyed by the requested name; files Commons lacks are left out. */
export async function commonsImages(files: string[]): Promise<Map<string, CommonsImage>> {
  const titles = files.map((file) => `File:${file}`);
  const json = (await call(
    {
      action: "query",
      prop: "imageinfo",
      iiprop: "mime|size|extmetadata",
      iiextmetadatafilter: "Artist|LicenseShortName|AttributionRequired",
      iiextmetadatalanguage: "en",
      titles: titles.join("|"),
      redirects: "1",
      formatversion: "2",
    },
    "https://commons.wikimedia.org/w/api.php",
  )) as { query?: { pages?: ImagePage[] } };
  const images = new Map<string, CommonsImage>();
  for (const [title, page] of pagesByRequest<ImagePage>(titles, json.query)) {
    const info = page.imageinfo?.[0];
    if (typeof page.title !== "string" || typeof info?.mime !== "string" || typeof info.width !== "number") continue;
    const field = (name: string) => {
      const value = info.extmetadata?.[name]?.value;
      return typeof value === "string" && value.trim() ? value : undefined;
    };
    images.set(title.slice("File:".length), {
      file: page.title.replace(/^File:/, ""),
      mime: info.mime,
      width: info.width,
      artist: field("Artist"),
      license: field("LicenseShortName"),
      attributionRequired: field("AttributionRequired") !== "false",
    });
  }
  return images;
}
