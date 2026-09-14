import { ConvexError } from 'convex/values';

import { fetchText, userAgent } from './politeFetch';

const ENDPOINT = 'https://api.tavily.com/search';
const TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export type TavilySearchRequest = {
  query: string;
  includeDomains: string[];
  topic?: 'general' | 'news';
  timeRange?: 'day' | 'week' | 'month' | 'year';
  includeAnswer?: 'basic' | 'advanced';
  includeImages?: boolean;
  maxResults?: number;
};

export type TavilyResult = {
  url: string;
  title: string;
  content: string;
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
    if (typeof entry === 'string') return [entry];
    const url = entry && typeof entry === 'object' ? (entry as { url?: unknown }).url : undefined;
    return typeof url === 'string' ? [url] : [];
  });
}

export function parseSearchResponse(json: unknown): TavilySearchResponse {
  const record = (json ?? {}) as Record<string, unknown>;
  const results = Array.isArray(record.results) ? record.results : [];
  const usage = record.usage as { credits?: unknown } | undefined;
  return {
    answer: typeof record.answer === 'string' ? record.answer : undefined,
    images: imageUrls(record.images),
    results: results.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return [];
      const row = entry as Record<string, unknown>;
      if (typeof row.url !== 'string') return [];
      return [{
        url: row.url,
        title: typeof row.title === 'string' ? row.title : '',
        content: typeof row.content === 'string' ? row.content : '',
        score: typeof row.score === 'number' ? row.score : 0,
        publishedDate: typeof row.published_date === 'string' ? row.published_date : undefined,
        images: imageUrls(row.images),
      }];
    }),
    credits: typeof usage?.credits === 'number' ? usage.credits : undefined,
    requestId: typeof record.request_id === 'string' ? record.request_id : undefined,
  };
}

// Keep search cost and source scope predictable: basic depth, auto parameters off, domain filtering.
export async function search(request: TavilySearchRequest): Promise<TavilySearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new ConvexError({ code: 'search_unconfigured' });
  const body = {
    query: request.query,
    search_depth: 'basic',
    auto_parameters: false,
    topic: request.topic ?? 'general',
    include_domains: request.includeDomains,
    include_domains_mode: 'filter',
    include_images: request.includeImages ?? false,
    max_results: request.maxResults ?? 5,
    include_usage: true,
    ...(request.timeRange ? { time_range: request.timeRange } : {}),
    ...(request.includeAnswer ? { include_answer: request.includeAnswer } : {}),
  };
  let page;
  try {
    page = await fetchText(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json',
        'User-Agent': userAgent(),
      },
      body: JSON.stringify(body),
    }, { timeoutMs: TIMEOUT_MS, maxBytes: MAX_RESPONSE_BYTES });
  } catch {
    throw new ConvexError({ code: 'search_error', reason: 'fetch_failed' });
  }
  if (page.status !== 200) throw new ConvexError({ code: 'search_error', reason: `http_${page.status}` });
  try {
    return parseSearchResponse(JSON.parse(page.body));
  } catch {
    throw new ConvexError({ code: 'search_error', reason: 'bad_json' });
  }
}
