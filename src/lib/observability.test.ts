import * as Sentry from "@sentry/react-native";
import { ConvexError } from "convex/values";

import {
  addBreadcrumb,
  reportError,
  sanitizeBreadcrumb,
  sanitizeEvent,
} from "./observability";

beforeEach(() => {
  jest.clearAllMocks();
});

test("reports a handled failure with its operation and stack, without serializing arbitrary error data", () => {
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
  expect(
    jest.mocked(Sentry.captureException).mock.calls[0][0],
  ).not.toHaveProperty("photo");
});

test.each([
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
  new Error(
    "Unable to download a file: The Internet connection appears to be offline.",
  ),
  new Error("Unable to upload a file: Network request failed"),
  new ConvexError({ code: "no_venue_site" }),
  new ConvexError({ code: "identity_unresolved" }),
  new ConvexError({ code: "album_full" }),
  new ConvexError({ code: "label_unverified" }),
  Object.assign(new Error("Couldn’t open the museum’s page"), {
    code: "page_unavailable",
    cause: new ConvexError({ code: "page_unavailable", reason: "http_429" }),
  }),
])(
  "keeps expected retry, validation and cancellation outcomes out of Sentry issues (%#)",
  (error) => {
    reportError(error, "test.expected");
    expect(Sentry.captureException).not.toHaveBeenCalled();
  },
);

test("reports distinct failures from the same operation within the retry window", () => {
  reportError(new Error("database disk is full"), "test.distinct");
  reportError(new Error("database is corrupt"), "test.distinct");
  expect(Sentry.captureException).toHaveBeenCalledTimes(2);
});

test("does not include parsed content or custom credentials in diagnostics", () => {
  const error = new SyntaxError('Unexpected token in "private label draft"');
  reportError(error, "test.parse", {
    data: {
      nonce: "secret nonce",
      assertionBase64: "secret assertion",
      deviceId: "private id",
    },
  });
  const [reported, context] = jest.mocked(Sentry.captureException).mock
    .calls[0];
  expect((reported as Error).message).toBe("Invalid data could not be parsed");
  expect((reported as Error).stack).not.toContain("private label draft");
  expect(JSON.stringify(context)).not.toMatch(
    /secret nonce|secret assertion|private id/,
  );
});

test("reports unexpected server codes without serializing server data", () => {
  reportError(
    new ConvexError({ code: "invalid_sync", note: "a private note" }),
    "test.sync",
  );
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.objectContaining({ message: "invalid_sync" }),
    expect.objectContaining({
      tags: { operation: "test.sync", error_code: "invalid_sync" },
    }),
  );
});

test("deduplicates propagated failures and throttles repeated retry errors, but reports again after a minute", () => {
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

test("unwraps an unexpected cause but filters wrapped offline failures", () => {
  const cause = new Error("model could not load");
  reportError(new Error("capture failed", { cause }), "test.cause");
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.objectContaining({ stack: cause.stack }),
    expect.anything(),
  );
  jest.clearAllMocks();
  reportError(
    new Error("capture failed", { cause: new Error("Network request failed") }),
    "test.offline-cause",
  );
  expect(Sentry.captureException).not.toHaveBeenCalled();
});

test("normalizes non-Error rejections without serializing arbitrary objects", () => {
  reportError(
    { token: "private token", message: "write failed" },
    "test.non-error",
  );
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.objectContaining({ message: "write failed" }),
    expect.anything(),
  );
  expect(
    jest.mocked(Sentry.captureException).mock.calls[0][0],
  ).not.toHaveProperty("token");
});

test("keeps useful breadcrumbs and drops console messages and navigation payloads", () => {
  addBreadcrumb("capture.started", { source: "camera" });
  expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
    category: "app",
    message: "capture.started",
    level: "info",
    data: { source: "camera" },
  });
  expect(
    sanitizeBreadcrumb({ category: "console", message: "private note" }),
  ).toBeNull();
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

test("scrubs credentials, image payloads, SQL parameters and request data before sending", () => {
  const event = sanitizeEvent({
    user: { email: "visitor@example.com" },
    request: { data: { note: "private note" } },
    extra: { photo: "raw photo bytes" },
    message:
      "GET https://example.com/photo?token=secret Bearer secret-token visitor@example.com file:///private/photo.jpg data:image/jpeg;base64,abcdef",
    exception: {
      values: [
        {
          value:
            "Failed query: insert into notes values (?)\nparams: private note",
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

test("telemetry failures cannot interrupt saving or recovery", () => {
  jest.mocked(Sentry.captureException).mockImplementationOnce(() => {
    throw new Error("telemetry failed");
  });
  expect(() =>
    reportError(new Error("write failed"), "test.telemetry"),
  ).not.toThrow();
  jest.mocked(Sentry.addBreadcrumb).mockImplementationOnce(() => {
    throw new Error("telemetry failed");
  });
  expect(() => addBreadcrumb("test.telemetry")).not.toThrow();
});

test("scrubs server validation values and SQL text containing private content", () => {
  const event = sanitizeEvent({
    exception: {
      values: [
        {
          value:
            '[CONVEX M(notes:save)] ArgumentValidationError: Value: {"note":"a private note"}',
        },
        {
          value:
            "Failed query: insert into notes values ('another private note')\nparams: []",
        },
      ],
    },
  });
  expect(event.exception.values.map(({ value }) => value)).toEqual([
    "Convex argument validation failed",
    "Database query failed",
  ]);
});
