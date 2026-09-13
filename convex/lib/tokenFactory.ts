import { ConvexError } from 'convex/values';

import { fetchText, userAgent } from './politeFetch';

const BASE_URL = 'https://api.tokenfactory.nebius.com/v1';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RETRY_DELAY_MS = 5000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type ChatJsonRequest<T> = {
  model: string;
  system: string;
  user: string;
  imageBase64?: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  parse: (value: unknown) => T | null;
  timeoutMs?: number;
};

// `calls` counts every request sent, including the retry, for spend reconciliation.
export type ChatJsonResponse<T> = { value: T; calls: number };

// Thinking is disabled through each model family's template parameter.
function chatTemplateKwargs(model: string): Record<string, boolean> {
  return /kimi/i.test(model) ? { thinking: false } : { enable_thinking: false };
}

export function retryDelayMs(retryAfter: string | null, now = Date.now()): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, seconds * 1000));
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, at - now));
  }
  return 1000;
}

function modelError(reason: string, calls: number): ConvexError<{ code: string; reason: string; calls: number }> {
  return new ConvexError({ code: 'model_error', reason, calls });
}

function parseCompletion<T>(body: string, parse: (value: unknown) => T | null, calls: number): T {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw modelError('bad_response', calls);
  }
  const choice = (json as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] }).choices?.[0];
  if (choice?.finish_reason === 'length') throw modelError('truncated', calls);
  const content = choice?.message?.content;
  if (typeof content !== 'string') throw modelError('bad_response', calls);
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw modelError('bad_json', calls);
  }
  const parsed = parse(value);
  if (parsed === null) throw modelError('schema', calls);
  return parsed;
}

export async function chatJson<T>(request: ChatJsonRequest<T>): Promise<ChatJsonResponse<T>> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) throw new ConvexError({ code: 'model_unconfigured', calls: 0 });
  const userContent = request.imageBase64 === undefined ? request.user : [
    { type: 'text', text: request.user },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${request.imageBase64}` } },
  ];
  const init: RequestInit = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json',
      'User-Agent': userAgent(),
    },
    body: JSON.stringify({
      model: request.model,
      messages: [{ role: 'system', content: request.system }, { role: 'user', content: userContent }],
      response_format: { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema: request.schema } },
      temperature: 0,
      max_tokens: request.maxTokens,
      chat_template_kwargs: chatTemplateKwargs(request.model),
    }),
  };
  let calls = 0;
  for (;;) {
    calls++;
    let page;
    try {
      page = await fetchText(`${BASE_URL}/chat/completions`, init, {
        timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBytes: MAX_RESPONSE_BYTES,
      });
    } catch {
      throw modelError('fetch_failed', calls);
    }
    if (page.status === 429 || page.status >= 500) {
      if (calls < 2) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(page.headers.get('retry-after'))));
        continue;
      }
      throw modelError(`http_${page.status}`, calls);
    }
    if (page.status !== 200) throw modelError(`http_${page.status}`, calls);
    return { value: parseCompletion(page.body, request.parse, calls), calls };
  }
}
