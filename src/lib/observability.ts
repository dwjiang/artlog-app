import * as Sentry from "@sentry/react-native";
import { ConvexError } from "convex/values";

import { isTransientError } from "./network-error";

type DiagnosticData = Record<string, string | number | boolean | null | undefined>;
type ReportOptions = { level?: "warning" | "error"; data?: DiagnosticData };

const expectedCodes = new Set([
  "ERR_REQUEST_CANCELED",
  "ERR_CANCELED",
  "ERR_CANCELLED",
  "ERR_CAMERA_PERMISSION",
  "ERR_LOCATION_UNAUTHORIZED",
  "ERR_LOCATION_SERVICES_DISABLED",
  "permission/camera-permission-denied",
  "not_found",
  "profile_required",
  "username_taken",
  "conflict",
  "friend_limit",
  "visit_private",
  "invalid_profile",
  "invalid_visit",
  "invalid_save",
  "invalid_venue",
  "invalid_relationship",
  "invalid_report",
  "apple_sign_in_required",
  "already_linked",
  "account_device_limit",
  "nothing_read",
  "label_flagged",
  "feature_off",
  "opted_out",
  "rate_limited",
  "network",
  "qr_host_not_allowed",
  "qr_no_artwork",
  "scan_restarted",
  "scan_not_found",
  "spend_cap",
  "no_venue_site",
  "venue_opted_out",
  "identity_unresolved",
  "image_mismatch",
  "search_superseded",
  "unknown_candidate",
  "page_unavailable",
  "bad_lines",
  "album_full",
  "note_too_long",
  "label_unverified",
  "field_mismatch",
  "invalid_scan",
]);
const reported = new WeakSet<object>();
const recent = new Map<string, number>();
const expectedMessages = new Set([
  "Journal owner changed",
  "Crop edit cancelled",
  "Photo upload cancelled",
  "Connect to publish your wall",
  "Wall request cancelled",
  "Wall account changed",
  "Wall account is not ready",
  "A wall update is in progress",
  "Refresh your wall first",
  "Note is unavailable",
]);

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  const data = error instanceof ConvexError ? error.data : error;
  if (
    data
    && typeof data === "object"
    && "code" in data
    && typeof data.code === "string"
    && /^[\w/-]{1,80}$/.test(data.code)
  ) {
    return data.code;
  }
}

function message(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Unknown error";
}

function expected(error: unknown): boolean {
  const nativeTransferMessage = message(error).match(/^Unable to (?:download|upload) a file:\s*(.*)$/)?.[1];
  return (
    isTransientError(error)
    || expectedCodes.has(errorCode(error) ?? "")
    || expectedCodes.has(message(error))
    || (nativeTransferMessage !== undefined && isTransientError(new Error(nativeTransferMessage)))
    || (error instanceof Error && error.name === "AbortError")
    || expectedMessages.has(message(error))
    || /^(Allow photo access in Settings\b|This visit is no longer available\b)/.test(message(error))
  );
}

function redact(value: string): string {
  if (value.includes("ArgumentValidationError")) {
    return "Convex argument validation failed";
  }
  return value
    .replace(/data:[^\s]+/gi, "[image data]")
    .replace(/(?:https?|file|ph):\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(token|secret|password|authorization|nonce|assertionBase64)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/"(token|secret|password|authorization|nonce|assertionBase64)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    .replace(/\bFailed query:[\s\S]*/gi, "Database query failed")
    .replace(/\bparams:[\s\S]*/gi, "params: [redacted]")
    .slice(0, 1_000);
}

function safeData(data: DiagnosticData | undefined): DiagnosticData | undefined {
  if (!data) return;
  return Object.fromEntries(
    Object.entries(data)
      .filter(
        ([key]) =>
          !/token|secret|password|email|photo|image|uri|url|path|note|text|query|latitude|longitude|nonce|assertion|keyId|deviceId|accountId|scope|^lat$|^lng$/i.test(
            key,
          ),
      )
      .map(([key, value]) => [key, typeof value === "string" ? redact(value) : value]),
  );
}

export function addBreadcrumb(operation: string, data?: DiagnosticData): void {
  try {
    Sentry.addBreadcrumb({
      category: "app",
      message: operation,
      level: "info",
      data: safeData(data),
    });
  } catch {
    /* Diagnostics must never prevent a save or its recovery. */
  }
}

export function reportError(error: unknown, operation: string, options: ReportOptions = {}): void {
  try {
    const chain: unknown[] = [error];
    // Wrappers keep user-facing copy; their cause holds the actionable native/server failure.
    while (chain.length < 5) {
      const last = chain.at(-1);
      if (!(last instanceof Error) || !last.cause || chain.includes(last.cause)) {
        break;
      }
      chain.push(last.cause);
    }
    if (chain.some(expected)) return;
    const objects = chain.filter((entry): entry is object => typeof entry === "object" && entry !== null);
    if (objects.some((entry) => reported.has(entry))) return;
    for (const entry of objects) reported.add(entry);
    const cause = chain.at(-1);
    const code = errorCode(cause) ?? errorCode(error);
    const description =
      cause instanceof ConvexError
        ? (code ?? "Convex request failed")
        : cause instanceof SyntaxError
          ? "Invalid data could not be parsed"
          : redact(message(cause));
    const key = `${operation}:${code ?? description.slice(0, 200)}`;
    const now = Date.now();
    const previous = recent.get(key);
    if (previous !== undefined && now - previous < 60_000) return;
    recent.delete(key);
    recent.set(key, now);
    if (recent.size > 100) recent.delete(recent.keys().next().value!);

    // Native and Convex errors can contain request bodies as custom properties.
    const normalized = new Error(description);
    normalized.name = cause instanceof Error ? cause.name : "Error";
    if (cause instanceof Error && cause.stack) {
      normalized.stack = `${normalized.name}: ${description}\n${cause.stack
        .split("\n")
        .filter((line) => /^\s+at\s|^[\w$.]+@/.test(line))
        .join("\n")}`;
    }
    Sentry.captureException(normalized, {
      level: options.level ?? "error",
      tags: { operation, ...(code ? { error_code: code } : {}) },
      contexts: { operation: safeData(options.data) ?? {} },
    });
  } catch {
    /* Diagnostics must never replace the original error or interrupt retries. */
  }
}

export function sanitizeBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (breadcrumb.category === "app") {
    return { ...breadcrumb, data: safeData(breadcrumb.data) };
  }
  // Console/native UI breadcrumbs can include OCR, private notes, coordinates and route parameters.
  if (
    breadcrumb.category !== "http"
    && breadcrumb.category !== "fetch"
    && breadcrumb.category !== "xhr"
    && breadcrumb.category !== "app.lifecycle"
  ) {
    return null;
  }
  const { method, status_code, state } = breadcrumb.data ?? {};
  return {
    ...breadcrumb,
    message: undefined,
    data: { method, status_code, state },
  };
}

export function sanitizeEvent<T extends Sentry.Event>(event: T): T {
  delete event.user;
  delete event.request;
  delete event.extra;
  if (event.message) event.message = redact(event.message);
  if (event.logentry) {
    if (event.logentry.message) {
      event.logentry.message = redact(event.logentry.message);
    }
    delete event.logentry.params;
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) {
      exception.value = exception.type === "SyntaxError" ? "Invalid data could not be parsed" : redact(exception.value);
    }
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }
  event.breadcrumbs = event.breadcrumbs
    ?.map(sanitizeBreadcrumb)
    .filter((entry): entry is Sentry.Breadcrumb => entry !== null);
  return event;
}
