import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { completion, jsonResponse } from "./labelFixtures";
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
      data: { code: "model_error", reason, calls: 1 },
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
      data: { code: "model_error", reason: "fetch_failed", calls: 1 },
    });
  });
});
