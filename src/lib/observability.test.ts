import * as Sentry from "@sentry/react-native";
import { ConvexError } from "convex/values";

import { addBreadcrumb, reportError, sanitizeBreadcrumb, sanitizeEvent, sanitizeTransaction } from "./observability";

beforeEach(() => {
  jest.clearAllMocks();
});

it("reports a handled failure with its operation and stack, without serializing arbitrary error data", () => {
  const error = Object.assign(new Error("disk is full"), {
    photo: "private image bytes",
  });
  reportError(error, "test.save", { data: { count: 2 } });
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.objectContaining({ message: "disk is full", stack: error.stack }),
    {
      level: "error",
      tags: { operation: "test.save" },
      contexts: { operation: { count: 2 } },
    },
  );
  expect(jest.mocked(Sentry.captureException).mock.calls[0][0]).not.toHaveProperty("photo");
});

it.each([
  new Error("Network request failed"),
  new ConvexError({ code: "rate_limited" }),
  new ConvexError({ code: "username_taken" }),
  new ConvexError({ code: "sync_scope_changed" }),
  Object.assign(new Error("Cancelled"), { code: "ERR_REQUEST_CANCELED" }),
  Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
  new Error("Journal owner changed"),
  new Error("Allow photo access in Settings to import a painting."),
  new Error("nothing_read"),
  new Error("Photo upload cancelled"),
  new ConvexError({ code: "qr_no_artwork" }),
  new ConvexError({ code: "spend_cap" }),
  Object.assign(new Error("Live Activities are not enabled"), { code: "ERR_LIVE_ACTIVITIES_NOT_SUPPORTED" }),
  new Error("Unable to download a file: The Internet connection appears to be offline."),
  new Error("Unable to upload a file: Network request failed"),
  new Error("fetch failed: The Internet connection appears to be offline."),
  new Error("fetch failed: The request timed out."),
  new ConvexError({ code: "no_venue_site" }),
  new ConvexError({ code: "venue_unavailable" }),
  new ConvexError({ code: "identity_unresolved" }),
  new ConvexError({ code: "album_full" }),
  new ConvexError({ code: "label_unverified" }),
  new ConvexError({ code: "sign_in_unavailable" }),
  Object.assign(new Error("Couldn’t open the museum’s page"), {
    code: "page_unavailable",
    cause: new ConvexError({ code: "page_unavailable", reason: "http_429" }),
  }),
])("keeps expected retry, validation and cancellation outcomes out of Sentry issues (%#)", (error) => {
  reportError(error, "test.expected");
  expect(Sentry.captureException).not.toHaveBeenCalled();
});

it("reports a routine code only for a caller that treats it as a failure, never an offline one", () => {
  reportError(new ConvexError({ code: "invalid_visit" }), "test.interactive");
  expect(Sentry.captureException).not.toHaveBeenCalled();
  reportError(new ConvexError({ code: "invalid_visit" }), "test.background", { alwaysReport: ["invalid_visit"] });
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.any(Error),
    expect.objectContaining({ tags: { operation: "test.background", error_code: "invalid_visit" } }),
  );
  reportError(new ConvexError({ code: "rate_limited" }), "test.background", { alwaysReport: ["rate_limited"] });
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
});

it("reports every failure, even an offline one, for a caller where any failure is a bug", () => {
  const offline = new Error("Network request failed");
  reportError(offline, "test.render", { alwaysReport: "all" });
  reportError(new ConvexError({ code: "not_found" }), "test.render", { alwaysReport: "all" });
  expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.any(Error),
    expect.objectContaining({ tags: { operation: "test.render", error_code: "not_found" } }),
  );
});

it("reports distinct failures from the same operation within the retry window", () => {
  reportError(new Error("database disk is full"), "test.distinct");
  reportError(new Error("database is corrupt"), "test.distinct");
  expect(Sentry.captureException).toHaveBeenCalledTimes(2);
});

it("does not include parsed content or custom credentials in diagnostics", () => {
  const error = new SyntaxError('Unexpected token in "private label draft"');
  reportError(error, "test.parse", {
    data: {
      nonce: "secret nonce",
      assertionBase64: "secret assertion",
      deviceId: "private id",
    },
  });
  const [reported, context] = jest.mocked(Sentry.captureException).mock.calls[0];
  expect((reported as Error).message).toBe("Invalid data could not be parsed");
  expect((reported as Error).stack).not.toContain("private label draft");
  expect(JSON.stringify(context)).not.toMatch(/secret nonce|secret assertion|private id/);
});

it("reports unexpected server codes without serializing server data", () => {
  reportError(new ConvexError({ code: "invalid_sync", note: "a private note" }), "test.sync");
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.objectContaining({ message: "invalid_sync" }),
    expect.objectContaining({
      tags: { operation: "test.sync", error_code: "invalid_sync" },
    }),
  );
});

it.each([
  [new ConvexError("Museum unavailable: The Louvre"), "string"],
  [new ConvexError({ reason: "a private note", calls: 1 }), "keys:calls,reason"],
])("tags the data shape of a server error without a code, never its values", (error, shape) => {
  reportError(error, `test.query.${shape}`);
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Convex request failed" }),
    expect.objectContaining({ tags: { operation: `test.query.${shape}`, convex_data: shape } }),
  );
  expect(JSON.stringify(jest.mocked(Sentry.captureException).mock.calls)).not.toMatch(/Louvre|private note/);
});

it("deduplicates propagated failures and throttles repeated retry errors, but reports again after a minute", () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(1_000);
  const failure = new Error("disk is full");
  reportError(failure, "test.retry");
  reportError(failure, "test.outer");
  reportError(new Error("disk is full"), "test.retry");
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  now.mockReturnValue(62_000);
  reportError(new Error("disk is full"), "test.retry");
  expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  now.mockRestore();
});

it("unwraps an unexpected cause but filters wrapped offline failures", () => {
  const cause = new Error("model could not load");
  reportError(new Error("capture failed", { cause }), "test.cause");
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.objectContaining({ stack: cause.stack }),
    expect.anything(),
  );
  jest.clearAllMocks();
  reportError(new Error("capture failed", { cause: new Error("Network request failed") }), "test.offline-cause");
  expect(Sentry.captureException).not.toHaveBeenCalled();
});

it("normalizes non-Error rejections without serializing arbitrary objects", () => {
  reportError({ token: "private token", message: "write failed" }, "test.non-error");
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.objectContaining({ message: "write failed" }),
    expect.anything(),
  );
  expect(jest.mocked(Sentry.captureException).mock.calls[0][0]).not.toHaveProperty("token");
});

it("keeps useful breadcrumbs and drops console messages and navigation payloads", () => {
  addBreadcrumb("capture.started", { source: "camera" });
  expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
    category: "app",
    message: "capture.started",
    level: "info",
    data: { source: "camera" },
  });
  expect(sanitizeBreadcrumb({ category: "console", message: "private note" })).toBeNull();
  expect(
    sanitizeBreadcrumb({
      category: "navigation",
      data: { to: "/profile/private-id" },
    }),
  ).toBeNull();
  expect(
    sanitizeBreadcrumb({
      category: "http",
      data: {
        url: "https://example.com/photo?token=secret",
        method: "GET",
        status_code: 500,
      },
    }),
  ).toEqual({ category: "http", data: { method: "GET", status_code: 500 } });
});

it("scrubs credentials, image payloads, SQL parameters and request data before sending", () => {
  const event = sanitizeEvent({
    user: { email: "visitor@example.com" },
    request: { data: { note: "private note" } },
    extra: { photo: "raw photo bytes" },
    message:
      "GET https://example.com/photo?token=secret Bearer secret-token visitor@example.com file:///private/photo.jpg data:image/jpeg;base64,abcdef",
    exception: {
      values: [
        {
          value: "Failed query: insert into notes values (?)\nparams: private note",
        },
      ],
    },
  });
  const payload = JSON.stringify(event);
  for (const secret of [
    "visitor@example.com",
    "secret-token",
    "private/photo.jpg",
    "abcdef",
    "private note",
    "raw photo bytes",
  ]) {
    expect(payload).not.toContain(secret);
  }
});

it("keeps only the host, method and status of traced requests", () => {
  const event = sanitizeTransaction({
    type: "transaction",
    transaction: "scan/[scanId]",
    user: { email: "visitor@example.com" },
    contexts: { trace: { trace_id: "t", span_id: "s", data: { url: "https://example.com/photo?token=secret" } } },
    spans: [
      {
        span_id: "a",
        trace_id: "t",
        start_timestamp: 0,
        op: "http.client",
        description: "GET https://bucket.example.com/photos/private-key.jpg?X-Amz-Signature=secret#crop",
        data: {
          url: "https://bucket.example.com/photos/private-key.jpg?X-Amz-Signature=secret#crop",
          "http.url": "https://bucket.example.com/photos/private-key.jpg",
          "http.query": "?X-Amz-Signature=secret",
          "http.fragment": "#crop",
          "http.method": "GET",
          "http.response.status_code": 403,
          "server.address": "bucket.example.com",
        },
      },
      { span_id: "b", trace_id: "t", start_timestamp: 0, description: "GET file:///private/photo.jpg", data: {} },
    ],
  });
  const payload = JSON.stringify(event);
  for (const secret of ["visitor@example.com", "secret", "private-key", "#crop", "private/photo.jpg"]) {
    expect(payload).not.toContain(secret);
  }
  expect(event.transaction).toBe("scan/[scanId]");
  expect(event.spans?.[0]).toMatchObject({
    description: "GET https://bucket.example.com",
    data: { "http.method": "GET", "http.response.status_code": 403, "server.address": "bucket.example.com" },
  });
});

it("telemetry failures cannot interrupt saving or recovery", () => {
  jest.mocked(Sentry.captureException).mockImplementationOnce(() => {
    throw new Error("telemetry failed");
  });
  expect(() => reportError(new Error("write failed"), "test.telemetry")).not.toThrow();
  jest.mocked(Sentry.addBreadcrumb).mockImplementationOnce(() => {
    throw new Error("telemetry failed");
  });
  expect(() => addBreadcrumb("test.telemetry")).not.toThrow();
});

it("scrubs server validation values and SQL text containing private content", () => {
  const event = sanitizeEvent({
    exception: {
      values: [
        {
          value: '[CONVEX M(notes:save)] ArgumentValidationError: Value: {"note":"a private note"}',
        },
        {
          value: "Failed query: insert into notes values ('another private note')\nparams: []",
        },
      ],
    },
  });
  expect(event.exception.values.map(({ value }) => value)).toEqual([
    "Convex argument validation failed",
    "Database query failed",
  ]);
});
