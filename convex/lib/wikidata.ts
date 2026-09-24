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
  mainsnak?: {
    snaktype?: string;
    datavalue?: { type?: string; value?: unknown };
  };
};

export type WikidataEntity = {
  id: string;
  missing?: string;
  labels?: Record<string, { value: string }>;
  claims?: Record<string, Claim[]>;
};

export type SearchHit = { id: string; label?: string; description?: string };

async function call(params: Record<string, string>): Promise<unknown> {
  const url = `${API}?${new URLSearchParams({ ...params, format: "json" })}`;
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

export async function searchEntities(
  term: string,
  limit = 10,
): Promise<SearchHit[]> {
  const json = (await call({
    action: "wbsearchentities",
    search: term,
    language: "en",
    type: "item",
    limit: String(limit),
  })) as { search?: unknown };
  if (!Array.isArray(json.search)) return [];
  return json.search.flatMap((hit: unknown) => {
    if (
      !hit
      || typeof hit !== "object"
      || typeof (hit as SearchHit).id !== "string"
    ) {
      return [];
    }
    const { id, label, description } = hit as SearchHit;
    return [{ id, label, description }];
  });
}

export async function getEntities(
  ids: string[],
  props = "labels|claims",
): Promise<Record<string, WikidataEntity>> {
  const unique = [...new Set(ids)];
  const entities: Record<string, WikidataEntity> = {};
  for (let offset = 0; offset < unique.length; offset += MAX_IDS) {
    const json = (await call({
      action: "wbgetentities",
      ids: unique.slice(offset, offset + MAX_IDS).join("|"),
      props,
      languages: "en",
    })) as { entities?: Record<string, WikidataEntity> };
    for (const [id, entity] of Object.entries(json.entities ?? {})) {
      if (
        entity
        && typeof entity === "object"
        && entity.missing === undefined
      ) {
        entities[id] = { ...entity, id };
      }
    }
  }
  return entities;
}

export async function getEntity(id: string): Promise<WikidataEntity | null> {
  return (await getEntities([id]))[id] ?? null;
}

export function entityLabel(
  entity: WikidataEntity,
  language = "en",
): string | undefined {
  return entity.labels?.[language]?.value;
}

function values(entity: WikidataEntity, property: string): unknown[] {
  return (entity.claims?.[property] ?? []).flatMap((claim) => {
    const snak = claim.mainsnak;
    return snak?.snaktype === "value" || snak?.datavalue
      ? [snak.datavalue?.value]
      : [];
  });
}

export function itemValues(entity: WikidataEntity, property: string): string[] {
  return values(entity, property).flatMap((value) => {
    const id =
      value && typeof value === "object"
        ? (value as { id?: unknown }).id
        : undefined;
    return typeof id === "string" ? [id] : [];
  });
}

export function stringValues(
  entity: WikidataEntity,
  property: string,
): string[] {
  return values(entity, property).flatMap((value) =>
    typeof value === "string" ? [value] : [],
  );
}

export function monolingualValues(
  entity: WikidataEntity,
  property: string,
): string[] {
  return values(entity, property).flatMap((value) => {
    const text =
      value && typeof value === "object"
        ? (value as { text?: unknown }).text
        : undefined;
    return typeof text === "string" ? [text] : [];
  });
}

export type Quantity = { amount: number; unit: string };

export function quantityValues(
  entity: WikidataEntity,
  property: string,
): Quantity[] {
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
    const time =
      value && typeof value === "object"
        ? (value as { time?: unknown }).time
        : undefined;
    const match =
      typeof time === "string" ? /^([+-])(\d{1,16})-/.exec(time) : null;
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
  return itemValues(entity, OCCUPATION).some((occupation) =>
    ARTIST_OCCUPATIONS.includes(occupation),
  );
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
