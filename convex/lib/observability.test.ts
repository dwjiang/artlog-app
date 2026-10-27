import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import { reportBackendError, withErrorReporting } from "./observability";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.sentry.io/123");
  fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("sends code locations and operation names without error text, input, or credentials", async () => {
  const error = Object.assign(new TypeError("private note alice@example.com token=secret"), {
    photo: "secret image",
  });
  error.stack = `${error.name}: ${error.message}\n    at handler (convex/docent.ts:45:9)\n    at fetch (https://example.com/private?token=secret:1:2)`;
  const id = await reportBackendError(error, "docent.ensure");
  expect(id).toMatch(/^[a-f0-9]{32}$/);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("https://example.ingest.sentry.io/api/123/envelope/");
  const body = String(init?.body);
  const event = JSON.parse(body.split("\n")[2]);
  expect(event).toMatchObject({
    environment: "production",
    tags: { operation: "docent.ensure", runtime: "convex" },
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Backend operation failed",
          stacktrace: {
            frames: [{ filename: "convex/docent.ts", lineno: 45, colno: 9 }],
          },
        },
      ],
    },
    fingerprint: ["convex", "docent.ensure", "{{ default }}"],
  });
  for (const value of ["private note", "alice@", "secret", "photo", "user", "request"]) {
    expect(body).not.toContain(value);
  }
});

it.each([
  "spend_cap",
  "rate_limited",
  "not_found",
  "scan_restarted",
  "invalid_photo",
  "unauthenticated",
  "invalid_attestation",
  "key_mismatch",
  "batch_too_large",
  "reviewer_required",
  "proposal_not_ready",
  "invalid_proposal_evidence",
])("ignores expected %s failures", async (code) => {
  expect(await reportBackendError(new ConvexError({ code }), "test.expected")).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("reports provider failures using only known codes and safe status reasons", async () => {
  await reportBackendError(
    new ConvexError({
      code: "model_error",
      reason: "http_503",
      prompt: "private text",
    }),
    "docent.ensure",
  );
  const event = JSON.parse(String(fetchMock.mock.calls[0][1]?.body).split("\n")[2]);
  expect(event.tags).toMatchObject({
    error_code: "model_error",
    reason: "http_503",
  });
  expect(event.fingerprint).toEqual(["convex", "docent.ensure", "model_error"]);
  expect(JSON.stringify(event)).not.toContain("private text");
});

it.each(["schema", "bad_json", "fetch_failed"])("tags the %s failure reason", async (reason) => {
  await reportBackendError(new ConvexError({ code: "model_error", reason }), "docent.ensure");
  const event = JSON.parse(String(fetchMock.mock.calls[0][1]?.body).split("\n")[2]);
  expect(event.tags).toMatchObject({ error_code: "model_error", reason });
});

it.each(["invalid_client", "invalid_grant"])("tags Apple's %s revocation rejection", async (reason) => {
  await reportBackendError(new ConvexError({ code: "apple_revoke_failed", reason }), "accounts.revoke_apple");
  const event = JSON.parse(String(fetchMock.mock.calls[0][1]?.body).split("\n")[2]);
  expect(event.tags).toMatchObject({ error_code: "apple_revoke_failed", reason });
});

it("names the research failure and the catalog work it left without a guide", async () => {
  const artworkId = "jd7artwork" as Id<"artworks">;
  await reportBackendError(new ConvexError({ code: "research_failed", reason: "prose_rejected" }), "docent.ensure", {
    artworkId,
  });
  const event = JSON.parse(String(fetchMock.mock.calls[0][1]?.body).split("\n")[2]);
  expect(event.tags).toMatchObject({ error_code: "research_failed", reason: "prose_rejected", artwork_id: artworkId });
  expect(event.exception.values[0].value).toBe("research_failed");
  expect(event.fingerprint).toEqual(["convex", "docent.ensure", "research_failed"]);
});

it("reports a rethrown error once, under the innermost operation", async () => {
  const failure = new TypeError("upload failed");
  await expect(
    withErrorReporting("collectionPhotos.upload", () =>
      withErrorReporting("files.store", () => Promise.reject(failure)),
    ),
  ).rejects.toBe(failure);
  await reportBackendError(failure, "collectionPhotos.upload");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const event = JSON.parse(String(fetchMock.mock.calls[0][1]?.body).split("\n")[2]);
  expect(event.tags.operation).toBe("files.store");
});

it("preserves the operation result and original error when reporting fails", async () => {
  fetchMock.mockRejectedValue(new Error("Sentry unavailable"));
  const failure = new Error("operation failed");
  await expect(
    withErrorReporting("test.failure", async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  await expect(withErrorReporting("test.success", async () => 42)).resolves.toBe(42);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("bounds reporting time even when the transport ignores cancellation", async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const reporting = reportBackendError(new Error("failure"), "test.timeout");
  await vi.advanceTimersByTimeAsync(2000);
  expect(await reporting).toBeNull();
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it("is a no-op when no backend DSN is configured", async () => {
  vi.stubEnv("SENTRY_DSN", "");
  expect(await reportBackendError(new Error("failure"), "test.disabled")).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("reports only allowlisted bounded model diagnostics", async () => {
  await reportBackendError(
    new ConvexError({
      code: "model_error",
      reason: "truncated",
      diagnostics: {
        model: "nvidia/nemotron-3-super-120b-a12b",
        stage: "completion",
        finishReason: "length",
        maxTokens: 12000,
        promptTokens: 800,
        completionTokens: 12000,
        calls: 2,
        elapsedMs: 1234,
        inputChars: 2000,
        outputChars: 4000,
        timeoutMs: 120000,
        prompt: "private text",
        response: "private output",
        url: "https://private.example/token",
      },
    }),
    "exhibitionRefresh.extract",
  );
  const event = JSON.parse(String(fetchMock.mock.calls[0][1]?.body).split("\n")[2]);
  expect(event.contexts.token_factory).toEqual({
    version: 1,
    model: "nvidia/nemotron-3-super-120b-a12b",
    stage: "completion",
    finishReason: "length",
    maxTokens: 12000,
    promptTokens: 800,
    completionTokens: 12000,
    calls: 2,
    elapsedMs: 1234,
    inputChars: 2000,
    outputChars: 4000,
    timeoutMs: 120000,
  });
  expect(JSON.stringify(event)).not.toContain("private");
});

it("drops unknown diagnostic strings and invalid numeric values", async () => {
  await reportBackendError(
    new ConvexError({
      code: "model_error",
      diagnostics: {
        model: "private-model-token",
        stage: "private-stage",
        finishReason: "private-output",
        maxTokens: -1,
        calls: 1.5,
        elapsedMs: Infinity,
        promptTokens: 1e20,
        completionTokens: "private",
        inputChars: NaN,
        outputChars: 0,
      },
    }),
    "exhibitionRefresh.extract",
  );
  const event = JSON.parse(String(fetchMock.mock.calls[0][1]?.body).split("\n")[2]);
  expect(event.contexts.token_factory).toEqual({ version: 1, model: "other", outputChars: 0 });
  expect(JSON.stringify(event)).not.toContain("private");
});
