import {
  createEnvelope,
  createStackParser,
  createTransport,
  getEnvelopeEndpointWithUrlEncodedAuth,
  makeDsn,
  nodeStackLineParser,
  type Event,
  type Transport,
} from "@sentry/core";
import { ConvexError } from "convex/values";

import { env } from "../_generated/server";

const expectedCodes = new Set([
  "spend_cap",
  "rate_limited",
  "feature_off",
  "opted_out",
  "venue_opted_out",
  "not_found",
  "scan_not_found",
  "artwork_not_found",
  "scan_restarted",
  "search_superseded",
  "nothing_read",
  "qr_host_not_allowed",
  "qr_no_artwork",
  "no_venue_site",
  "image_mismatch",
  "identity_unresolved",
  "unknown_candidate",
  "unauthenticated",
  "device_banned",
  "device_not_registered",
  "device_not_attested",
  "invalid_assertion",
  "invalid_attestation",
  "key_mismatch",
  "challenge_invalid",
  "device_already_attested",
  "key_already_registered",
  "invalid_photo",
  "photo_too_large",
  "invalid_media",
  "invalid_profile_photo",
  "invalid_profile",
  "profile_not_allowed",
  "comment_not_allowed",
  "reflection_not_allowed",
  "note_not_allowed",
  "invalid_comment",
  "invalid_post",
  "invalid_wall",
  "conflict",
  "profile_required",
  "sync_scope_changed",
  "claim_required",
  "invalid_scan",
  "recognition_unavailable",
  "recognition_model_retired",
  "saved_artwork_changed",
  "invalid_venue",
  "bad_features",
  "bad_vector",
  "bad_lines",
  "bad_crop",
  "bad_orb_file",
  "label_unverified",
  "field_mismatch",
  "contribution_busy",
  "contribution_not_found",
  "contributions_changed",
  "crop_already_shared",
  "duplicate_entry",
  "reviewer_required",
  "proposal_not_found",
  "proposal_already_reviewed",
  "object_not_found",
  "proposal_kind_changed",
  "invalid_proposal_evidence",
  "proposal_not_ready",
  "too_many_current_placements",
  "reference_descriptors_required",
  "batch_too_large",
  "duplicate_descriptor_keys",
  "bad_descriptors",
  "invalid_import_file",
  "unknown_key",
  "bad_dimension",
  "thumbnail_rights",
]);
const diagnosticCodes = new Set([
  "model_error",
  "model_unconfigured",
  "narration_not_configured",
  "search_error",
  "search_unconfigured",
  "wikidata_error",
  "artic_error",
  "page_unavailable",
  "attest_unconfigured",
  "apple_unconfigured",
  "google_unconfigured",
  "orb_file_missing",
  "vector_payload_missing",
  "import_upload_mismatch",
  "bad_candidates",
  "push_send_failed",
  "push_invalid_credentials",
  "push_message_too_big",
  "push_rate_exceeded",
  "push_rejected",
]);
const errorTypes = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TimeoutError",
  "ConvexError",
]);
const parseStack = createStackParser(nodeStackLineParser());
const TIMEOUT_MS = 1500;
let cached: { dsn: string; transport: Transport } | undefined;
const reported = new WeakSet<object>();

function errorData(error: unknown): { code?: string; reason?: string } {
  if (!(error instanceof ConvexError) || !error.data || typeof error.data !== "object") {
    return {};
  }
  const { code, reason } = error.data as Record<string, unknown>;
  return {
    code: typeof code === "string" ? code : undefined,
    reason: typeof reason === "string" ? reason : undefined,
  };
}

function frames(error: unknown) {
  const stack = error instanceof Error ? error.stack : typeof error === "string" ? error : undefined;
  return parseStack(stack ?? "")
    .flatMap((frame) => {
      const path =
        frame.filename?.match(/(?:^|\/)(convex\/[\w./-]+\.[cm]?[jt]s)$/)?.[1]
        ?? frame.filename?.match(/^convex:\/user\/([\w./-]+\.js)$/)?.[1];
      return path
        ? [
            {
              filename: path.startsWith("convex/") ? path : `convex/${path}`,
              lineno: frame.lineno,
              colno: frame.colno,
              in_app: true,
            },
          ]
        : [];
    })
    .slice(-30);
}

function transportFor(dsn: string): Transport | undefined {
  if (cached?.dsn === dsn) return cached.transport;
  const parsed = makeDsn(dsn);
  if (!parsed || parsed.protocol !== "https") return;
  const url = getEnvelopeEndpointWithUrlEncodedAuth(parsed);
  const transport = createTransport({ recordDroppedEvent: () => {}, bufferSize: 10 }, async ({ body }) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-sentry-envelope" },
          body: typeof body === "string" ? body : new TextDecoder().decode(body),
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Sentry timeout"));
          }, TIMEOUT_MS);
        }),
      ]);
      return {
        statusCode: response.status,
        headers: {
          "x-sentry-rate-limits": response.headers.get("x-sentry-rate-limits"),
          "retry-after": response.headers.get("retry-after"),
        },
      };
    } finally {
      clearTimeout(timer);
    }
  });
  cached = { dsn, transport };
  return transport;
}

export async function reportBackendError(error: unknown, operation: string): Promise<string | null> {
  try {
    const dsn = env.SENTRY_DSN;
    if (!dsn) return null;
    const { code, reason } = errorData(error);
    if ((code && expectedCodes.has(code)) || (error instanceof Error && error.name === "AbortError")) {
      return null;
    }
    // A rethrown error reaches every enclosing reporter; the innermost operation names it best.
    if (typeof error === "object" && error !== null) {
      if (reported.has(error)) return null;
      reported.add(error);
    }
    const transport = transportFor(dsn);
    if (!transport) return null;
    const eventId = crypto.randomUUID().replaceAll("-", "");
    const safeCode = code && diagnosticCodes.has(code) ? code : undefined;
    const safeReason =
      reason
      && /^(http_[45]\d\d|bad_response|bad_json|schema|truncated|timeout|network|fetch_failed|invalid_output)$/.test(
        reason,
      )
        ? reason
        : undefined;
    // Error messages, ConvexError.data, arguments and SDK global scopes can contain user content.
    // Build an allowlisted event instead of serializing the original exception.
    const event: Event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "javascript",
      level: "error",
      environment: env.SENTRY_ENVIRONMENT ?? "backend",
      tags: {
        runtime: "convex",
        operation,
        ...(safeCode ? { error_code: safeCode } : {}),
        ...(safeReason ? { reason: safeReason } : {}),
      },
      exception: {
        values: [
          {
            type: error instanceof Error && errorTypes.has(error.name) ? error.name : "Error",
            value: safeCode ?? "Backend operation failed",
            stacktrace: { frames: frames(error) },
          },
        ],
      },
      fingerprint: ["convex", operation, safeCode ?? "{{ default }}"],
    };
    const result = await transport.send(createEnvelope({ event_id: eventId }, [[{ type: "event" }, event]]));
    return result.statusCode && result.statusCode >= 200 && result.statusCode < 300 ? eventId : null;
  } catch {
    return null;
  }
}

export async function withErrorReporting<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    await reportBackendError(error, operation);
    throw error;
  }
}
