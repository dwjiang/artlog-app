import { ConvexError } from "convex/values";

import { env } from "../_generated/server";
import { fetchText, userAgent } from "./politeFetch";

const ENDPOINT = "https://api.tavily.com/search";
const TIMEOUT_MS = 8000;
export const REFERENCE_EXTRACTION_CREDITS = 2;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export type TavilySearchRequest = {
  query: string;
  includeDomains: string[];
  topic?: "general" | "news";
  timeRange?: "day" | "week" | "month" | "year";
  includeAnswer?: "basic" | "advanced";
  includeImages?: boolean;
  includeRawContent?: boolean;
  maxResults?: number;
};

export type TavilyResult = {
  url: string;
  title: string;
  content: string;
  rawContent?: string;
  score: number;
  publishedDate?: string;
  images: string[];
};

export type TavilySearchResponse = {
  answer?: string;
  images: string[];
  results: TavilyResult[];
  credits?: number;
  requestId?: string;
};

function imageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    const url = entry && typeof entry === "object" ? (entry as { url?: unknown }).url : undefined;
    return typeof url === "string" ? [url] : [];
  });
}

export function parseSearchResponse(json: unknown): TavilySearchResponse {
  const record = (json ?? {}) as Record<string, unknown>;
  const results = Array.isArray(record.results) ? record.results : [];
  const usage = record.usage as { credits?: unknown } | undefined;
  return {
    answer: typeof record.answer === "string" ? record.answer : undefined,
    images: imageUrls(record.images),
    results: results.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      if (typeof row.url !== "string") return [];
      return [
        {
          url: row.url,
          title: typeof row.title === "string" ? row.title : "",
          content: typeof row.content === "string" ? row.content : "",
          rawContent: typeof row.raw_content === "string" ? row.raw_content : undefined,
          score: typeof row.score === "number" ? row.score : 0,
          publishedDate: typeof row.published_date === "string" ? row.published_date : undefined,
          images: imageUrls(row.images),
        },
      ];
    }),
    credits: typeof usage?.credits === "number" ? usage.credits : undefined,
    requestId: typeof record.request_id === "string" ? record.request_id : undefined,
  };
}

// Keep search cost and source scope predictable: basic depth, auto parameters off, domain filtering.
export async function search(request: TavilySearchRequest): Promise<TavilySearchResponse> {
  const body = {
    query: request.query,
    search_depth: "basic",
    auto_parameters: false,
    topic: request.topic ?? "general",
    include_domains: request.includeDomains,
    include_domains_mode: "filter",
    include_images: request.includeImages ?? false,
    max_results: request.maxResults ?? 5,
    include_usage: true,
    ...(request.includeRawContent ? { include_raw_content: "markdown" } : {}),
    ...(request.timeRange ? { time_range: request.timeRange } : {}),
    ...(request.includeAnswer ? { include_answer: request.includeAnswer } : {}),
  };
  return parseSearchResponse(await requestJson(ENDPOINT, body, request.includeRawContent ? 20_000 : TIMEOUT_MS));
}

async function requestJson(endpoint: string, body: object, timeoutMs: number): Promise<unknown> {
  const apiKey = env.TAVILY_API_KEY;
  if (!apiKey) throw new ConvexError({ code: "search_unconfigured" });
  let page;
  try {
    page = await fetchText(
      endpoint,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": userAgent(),
        },
        body: JSON.stringify(body),
      },
      {
        timeoutMs,
        maxBytes: MAX_RESPONSE_BYTES,
      },
    );
  } catch {
    throw new ConvexError({ code: "search_error", reason: "fetch_failed" });
  }
  if (page.status !== 200) {
    throw new ConvexError({
      code: "search_error",
      reason: `http_${page.status}`,
    });
  }
  try {
    return JSON.parse(page.body);
  } catch {
    throw new ConvexError({ code: "search_error", reason: "bad_json" });
  }
}

export type TavilyExtractResponse = { results: { url: string; text: string }[]; failures: number; credits?: number };

export async function extract(urls: string[]): Promise<TavilyExtractResponse> {
  if (urls.length === 0 || urls.length > 5) throw new ConvexError({ code: "invalid_reference_count" });
  const value = (await requestJson(
    "https://api.tavily.com/extract",
    {
      urls,
      extract_depth: "advanced",
      format: "text",
      include_images: false,
      include_usage: true,
      timeout: 20,
    },
    30_000,
  )) as { results?: { url?: unknown; raw_content?: unknown }[]; usage?: { credits?: number } };
  const results = (value.results ?? []).flatMap((row) =>
    typeof row.url === "string"
    && urls.includes(row.url)
    && typeof row.raw_content === "string"
    && row.raw_content.trim()
      ? [{ url: row.url, text: row.raw_content }]
      : [],
  );
  return {
    results,
    failures: urls.filter((url) => !results.some((row) => row.url === url)).length,
    credits: value.usage?.credits,
  };
}
