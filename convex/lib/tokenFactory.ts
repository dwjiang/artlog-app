import { ConvexError } from "convex/values";

import { env } from "../_generated/server";
import { fetchText, userAgent } from "./politeFetch";
import { tokenFactoryDiagnostics } from "./tokenFactoryDiagnostics";

const BASE_URL = "https://api.tokenfactory.nebius.com/v1";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RETRY_DELAY_MS = 5000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type ChatJsonRequest<T> = {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  parse: (value: unknown) => T | null;
  timeoutMs?: number;
};

export type TokenUsage = { promptTokens: number; completionTokens: number };

// `calls` counts every request sent, including the retry, for spend reconciliation; `usage` is what
// the provider reported for the request that answered.
export type ChatJsonResponse<T> = { value: T; calls: number; usage?: TokenUsage };

export function retryDelayMs(retryAfter: string | null, now = Date.now()): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, seconds * 1000));
    }
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, at - now));
    }
  }
  return 1000;
}

// `schema` names the call that failed, so a report tells a fact sheet from a review or a guide.
function modelError(reason: string, calls: number, schema: string, diagnostics: Record<string, unknown>) {
  return new ConvexError({
    code: "model_error",
    reason,
    calls,
    schema,
    diagnostics: tokenFactoryDiagnostics({ ...diagnostics, calls })!,
  });
}

function tokenUsage(json: unknown): TokenUsage | undefined {
  const { usage } = json as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
  return typeof usage?.prompt_tokens === "number" && typeof usage.completion_tokens === "number"
    ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens }
    : undefined;
}

function parseCompletion<T>(
  json: unknown,
  parse: (value: unknown) => T | null,
  calls: number,
  schema: string,
  diagnostics: Record<string, unknown>,
): T {
  const choice = (
    json as {
      choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
    }
  ).choices?.[0];
  if (choice?.finish_reason === "length") {
    throw modelError("truncated", calls, schema, { ...diagnostics, stage: "completion" });
  }
  const content = choice?.message?.content;
  if (typeof content !== "string") {
    throw modelError("bad_response", calls, schema, { ...diagnostics, stage: "completion" });
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw modelError("bad_json", calls, schema, { ...diagnostics, stage: "json" });
  }
  const parsed = parse(value);
  if (parsed === null) throw modelError("schema", calls, schema, { ...diagnostics, stage: "schema" });
  return parsed;
}

export async function chatJson<T>(request: ChatJsonRequest<T>): Promise<ChatJsonResponse<T>> {
  const apiKey = env.NEBIUS_API_KEY;
  if (!apiKey) throw new ConvexError({ code: "model_unconfigured", calls: 0 });
  const init: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": userAgent(),
    },
    body: JSON.stringify({
      model: request.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.schemaName,
          strict: true,
          schema: request.schema,
        },
      },
      temperature: 0,
      max_tokens: request.maxTokens,
      // Every task runs without reasoning; with a strict schema it is faster and no less grounded.
      chat_template_kwargs: { enable_thinking: false },
    }),
  };
  let calls = 0;
  for (;;) {
    calls++;
    const started = Date.now();
    const diagnostics = (stage: string) => ({
      model: request.model,
      maxTokens: request.maxTokens,
      inputChars: request.system.length + request.user.length,
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      elapsedMs: Date.now() - started,
      stage,
    });
    let page;
    try {
      page = await fetchText(`${BASE_URL}/chat/completions`, init, {
        timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBytes: MAX_RESPONSE_BYTES,
      });
    } catch {
      throw modelError("fetch_failed", calls, request.schemaName, diagnostics("fetch"));
    }
    if (page.status === 429 || page.status >= 500) {
      if (calls < 2) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(page.headers.get("retry-after"))));
        continue;
      }
      throw modelError(`http_${page.status}`, calls, request.schemaName, diagnostics("http"));
    }
    if (page.status !== 200) throw modelError(`http_${page.status}`, calls, request.schemaName, diagnostics("http"));
    let json: unknown;
    try {
      json = JSON.parse(page.body);
    } catch {
      throw modelError("bad_response", calls, request.schemaName, diagnostics("response"));
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw modelError("bad_response", calls, request.schemaName, diagnostics("response"));
    }
    const usage = tokenUsage(json);
    const choice = (json as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] }).choices?.[0];
    const completionDiagnostics = {
      ...diagnostics("completion"),
      ...usage,
      finishReason: choice?.finish_reason,
      outputChars: typeof choice?.message?.content === "string" ? choice.message.content.length : undefined,
    };
    // Tokens are what the bill counts and the spend table only counts calls; one line per answer,
    // before the content is checked, keeps every model's cost measurable from the logs.
    console.log(
      "tokenFactory usage",
      JSON.stringify({ model: request.model, schema: request.schemaName, ...usage, ms: Date.now() - started, calls }),
    );
    return {
      value: parseCompletion(json, request.parse, calls, request.schemaName, completionDiagnostics),
      calls,
      usage,
    };
  }
}
