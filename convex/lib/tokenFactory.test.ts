import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { completion, jsonResponse } from "./labelFixtures";
import { reportBackendError } from "./observability";
import { chatJson, retryDelayMs } from "./tokenFactory";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEBIUS_API_KEY", "test-key");
  vi.stubEnv("CRAWLER_CONTACT", "ops@example.org");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const parse = (value: unknown) =>
  value && typeof value === "object" && "ok" in value ? (value as { ok: boolean }) : null;
const request = {
  model: "nvidia/Nemotron-3_5-Lightning",
  system: "sys",
  user: "usr",
  schemaName: "probe",
  schema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  },
  maxTokens: 64,
  parse,
};

describe("Token Factory chatJson", () => {
  it("sends a strict json_schema request with thinking disabled and parses the JSON content", async () => {
    fetchMock.mockResolvedValueOnce(completion({ ok: true }));
    await expect(chatJson(request)).resolves.toEqual({
      value: { ok: true },
      calls: 1,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.tokenfactory.nebius.com/v1/chat/completions");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
        "User-Agent": "artlog-bot/0.1 (+https://github.com/dwjiang/artlog-app; mailto:ops@example.org)",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "nvidia/Nemotron-3_5-Lightning",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "probe", strict: true, schema: request.schema },
      },
      temperature: 0,
      max_tokens: 64,
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it("returns the provider's token counts and logs them without the content", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: JSON.stringify({ ok: true }) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 673, completion_tokens: 124, total_tokens: 797 },
      }),
    );
    await expect(chatJson(request)).resolves.toEqual({
      value: { ok: true },
      calls: 1,
      usage: { promptTokens: 673, completionTokens: 124 },
    });
    expect(log).toHaveBeenCalledWith(
      "tokenFactory usage",
      expect.stringContaining(
        '"model":"nvidia/Nemotron-3_5-Lightning","schema":"probe","promptTokens":673,"completionTokens":124',
      ),
    );
    expect(log.mock.calls[0][1]).not.toContain("usr");
  });

  it("retries once on 429 honoring Retry-After capped at five seconds, then counts both calls", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "30" } }))
      .mockResolvedValueOnce(completion({ ok: true }));
    const pending = chatJson(request);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ value: { ok: true }, calls: 2 });
    expect(retryDelayMs(null)).toBe(1000);
    expect(retryDelayMs("2")).toBe(2000);
    expect(retryDelayMs(new Date(Date.now() + 3000).toUTCString(), Date.now())).toBeLessThanOrEqual(3000);
  });

  it("gives up after the second 5xx with the call count attached", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
    const pending = chatJson(request).catch((error) => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({
      data: { code: "model_error", reason: "http_503", calls: 2 },
    });
  });

  it.each([
    [
      "bad_json",
      jsonResponse({
        choices: [{ message: { content: "{not json" }, finish_reason: "stop" }],
      }),
    ],
    ["schema", completion({ nope: 1 })],
    ["truncated", completion({ ok: true }, "length")],
    ["bad_response", jsonResponse({ choices: [] })],
    ["http_401", new Response("no", { status: 401 })],
  ])("rejects malformed output as %s without repairing it", async (reason, response) => {
    fetchMock.mockResolvedValueOnce(response);
    await expect(chatJson(request)).rejects.toMatchObject({
      data: {
        code: "model_error",
        reason,
        calls: 1,
        diagnostics: {
          stage: (
            {
              bad_json: "json",
              schema: "schema",
              truncated: "completion",
              bad_response: "completion",
              http_401: "http",
            } as Record<string, string>
          )[reason],
        },
      },
    });
  });

  it("fails fast without a key and on network errors", async () => {
    vi.stubEnv("NEBIUS_API_KEY", "");
    await expect(chatJson(request)).rejects.toMatchObject({
      data: { code: "model_unconfigured" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("NEBIUS_API_KEY", "k");
    fetchMock.mockRejectedValueOnce(new Error("aborted"));
    await expect(chatJson(request)).rejects.toMatchObject({
      data: { code: "model_error", reason: "fetch_failed", calls: 1, diagnostics: { stage: "fetch", calls: 1 } },
    });
  });
});

it("retains bounded diagnostics for truncation without request or response content", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      choices: [{ message: { content: "private output" }, finish_reason: "length" }],
      usage: { prompt_tokens: 123, completion_tokens: 64 },
    }),
  );
  const error = await chatJson({ ...request, user: "private input" }).catch((e) => e);
  expect(error.data.diagnostics).toMatchObject({
    version: 1,
    model: request.model,
    stage: "completion",
    finishReason: "length",
    maxTokens: 64,
    promptTokens: 123,
    completionTokens: 64,
    calls: 1,
    inputChars: 16,
    outputChars: 14,
    timeoutMs: 8000,
  });
  expect(JSON.stringify(error.data)).not.toMatch(/private input|private output|test-key/);
});

it.each([null, [], "private response"])("classifies non-object responses without exposing them", async (response) => {
  fetchMock.mockResolvedValueOnce(jsonResponse(response));
  await expect(chatJson(request)).rejects.toMatchObject({
    data: {
      code: "model_error",
      reason: "bad_response",
      diagnostics: { stage: "response" },
    },
  });
});

it("retains only the final attempt's usage and counts both requests", async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValueOnce(new Response("private upstream error", { status: 503 })).mockResolvedValueOnce(
    jsonResponse({
      choices: [{ message: { content: "private output" }, finish_reason: "length" }],
      usage: { prompt_tokens: 50, completion_tokens: 64 },
    }),
  );
  const pending = chatJson(request).catch((error) => error);
  await vi.advanceTimersByTimeAsync(1000);
  expect((await pending).data.diagnostics).toMatchObject({
    calls: 2,
    promptTokens: 50,
    completionTokens: 64,
    finishReason: "length",
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("carries truncation diagnostics through the backend Sentry envelope", async () => {
  vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/123");
  fetchMock
    .mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "private output" }, finish_reason: "length" }],
        usage: { prompt_tokens: 800, completion_tokens: 12000 },
      }),
    )
    .mockResolvedValueOnce(new Response("{}", { status: 200 }));
  const failure = await chatJson({
    ...request,
    model: "nvidia/Nemotron-3.5-Super-VL",
    maxTokens: 12000,
    user: "private input",
  }).catch((error) => error);
  await reportBackendError(failure, "exhibitionRefresh.extract");
  const body = String(fetchMock.mock.calls[1][1]?.body);
  const event = JSON.parse(body.split("\n")[2]);
  expect(event.contexts.token_factory).toMatchObject({
    model: "nvidia/Nemotron-3.5-Super-VL",
    maxTokens: 12000,
    promptTokens: 800,
    completionTokens: 12000,
    finishReason: "length",
    stage: "completion",
  });
  expect(event.tags).toMatchObject({ operation: "exhibitionRefresh.extract", reason: "truncated" });
  expect(body).not.toMatch(/private input|private output|test-key/);
});

it.each([
  ["header_timeout", "AbortError"],
  ["body_timeout", "AbortError"],
  ["network", "TypeError"],
  ["timeout_error", "TimeoutError"],
  ["generic_error", "Error"],
  ["custom_name", "other"],
  ["untyped", "other"],
])("reports %s without exposing error content or retrying transport failures", async (failure, fetchErrorName) => {
  vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/123");
  const envelopes: string[] = [];
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).startsWith("https://example.ingest.sentry.io/")) {
      envelopes.push(String(init?.body));
      return new Response("{}");
    }
    if (failure === "header_timeout") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("private_error", "AbortError")));
      });
    }
    if (failure === "body_timeout") {
      return new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("private_error", "AbortError")),
            );
          },
        }),
      );
    }
    if (failure === "timeout_error") throw new DOMException("private_error", "TimeoutError");
    if (failure === "generic_error") throw new Error("private_error");
    if (failure === "untyped") throw { name: "AbortError", message: "private_error" };
    if (failure === "custom_name") {
      const error = new Error("private_error");
      error.name = "private_error_name";
      throw error;
    }
    throw new TypeError("private_error https://private.example/?token=private_token");
  });
  const timed = failure.endsWith("timeout");
  if (timed) vi.useFakeTimers();
  const pending = chatJson({ ...request, user: "private input", schemaName: "referenceReview" }).catch(
    (error: unknown) => error,
  );
  if (timed) await vi.advanceTimersByTimeAsync(8000);
  const error = await pending;
  vi.useRealTimers();
  expect(error).toMatchObject({
    data: {
      code: "model_error",
      reason: "fetch_failed",
      schema: "referenceReview",
      calls: 1,
      diagnostics: { stage: "fetch", fetchErrorName },
    },
  });
  await reportBackendError(error, "docent.referenceReview");
  expect(envelopes).toHaveLength(1);
  const event = JSON.parse(envelopes[0].split("\n")[2]);
  expect(event.tags).toMatchObject({ operation: "docent.referenceReview", reason: "fetch_failed" });
  expect(event.contexts.token_factory).toMatchObject({ fetchErrorName, calls: 1, stage: "fetch" });
  expect(event.contexts.token_factory).not.toHaveProperty("previousHttpStatus");
  for (const marker of ["private input", "private_error", "private.example", "private_token", "test-key"]) {
    expect(envelopes[0]).not.toContain(marker);
  }
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each([429, 529])("retains the first HTTP %s when the retry fails in transport", async (status) => {
  vi.useFakeTimers();
  vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/123");
  fetchMock
    .mockResolvedValueOnce(new Response("private response", { status }))
    .mockRejectedValueOnce(new TypeError("private error"))
    .mockResolvedValueOnce(new Response("{}"));
  const pending = chatJson({ ...request, schemaName: "referenceReview" }).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1000);
  const error = await pending;
  vi.useRealTimers();
  expect(error).toMatchObject({
    data: {
      reason: "fetch_failed",
      calls: 2,
      diagnostics: { fetchErrorName: "TypeError", previousHttpStatus: status },
    },
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await reportBackendError(error, "docent.referenceReview");
  const envelope = String(fetchMock.mock.calls[2][1]?.body);
  const event = JSON.parse(envelope.split("\n")[2]);
  expect(event.contexts.token_factory).toMatchObject({
    fetchErrorName: "TypeError",
    previousHttpStatus: status,
    calls: 2,
  });
  expect(envelope).not.toMatch(/private response|private error|test-key/);
});
