import { ConvexError } from "convex/values";

/** Transport failures: the request never reached the server or its reply never arrived. */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof ConvexError || !(error instanceof Error)) return false;
  return (
    /^(Network request failed|Network request timed out|Failed to fetch|Load failed|The Internet connection appears to be offline\.?)$/i.test(
      error.message,
    )
    || /^(?:\[CONVEX A\([^\n]+\)\] )?Connection lost while action was in flight(?:\n  Called by client)?$/.test(
      error.message,
    )
  );
}

export function convexErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ConvexError) || typeof error.data !== "object" || error.data === null) {
    return;
  }
  const code = (error.data as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** The phone could not attempt the request yet (sync paused, app in the background); nothing on the phone has to change first. */
export class SyncUnavailableError extends Error {
  constructor() {
    super("Journal sync is not available right now");
    this.name = "SyncUnavailableError";
  }
}

/** Failures a later retry can fix with no change on the phone. */
export function isTransientError(error: unknown): boolean {
  const code = convexErrorCode(error);
  return (
    error instanceof SyncUnavailableError
    || isNetworkError(error)
    || code === "unauthenticated"
    || code === "device_not_registered"
    || code === "rate_limited"
    || code === "claim_required"
    || code === "sync_scope_changed"
  );
}

export function rateLimitRetryAfterMs(error: unknown): number | undefined {
  if (!(error instanceof ConvexError) || convexErrorCode(error) !== "rate_limited") {
    return;
  }
  const retryAfter = (error.data as { retryAfter?: unknown }).retryAfter;
  return typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : undefined;
}

export function errorMessage(error: unknown): string {
  return convexErrorCode(error) ?? (error instanceof Error ? error.message : String(error));
}
