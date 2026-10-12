import { ConvexError } from "convex/values";

// Fetch and iOS URL loading messages for a failed connection, as opposed to a failed server or request.
const TRANSPORT_FAILURE =
  /^(?:Network request failed|Network request timed out|Failed to fetch|Load failed|The Internet connection appears to be offline|The request timed out|The network connection was lost|Could not connect to the server|A server with the specified hostname could not be found|A data connection is not currently allowed|International roaming is currently off)\.?$/i;

/** Transport failures: the request never reached the server or its reply never arrived. */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof ConvexError || !(error instanceof Error)) return false;
  // Native transfers and expo/fetch prefix the URL loading error with their own context.
  const message = error.message.replace(/^(?:Unable to (?:download|upload) a file|fetch failed):\s*/, "");
  return (
    TRANSPORT_FAILURE.test(message)
    || /^(?:\[CONVEX A\([^\n]+\)\] )?Connection lost while action was in flight(?:\n  Called by client)?$/.test(message)
  );
}

/** The backend answered with this failure, so reporting it is the backend’s job. */
export function isBackendError(error: unknown): boolean {
  return (
    error instanceof ConvexError
    || (error instanceof Error && /^\[CONVEX [AMQ]\(/.test(error.message) && !isNetworkError(error))
  );
}

/** The phone had no connection, so the request was not attempted. */
export class OfflineError extends Error {
  constructor() {
    super("The Internet connection appears to be offline.");
    this.name = "OfflineError";
  }
}

export function convexErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ConvexError) || typeof error.data !== "object" || error.data === null) {
    return;
  }
  const { code } = error.data as { code?: unknown };
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
  const rateLimitedTransfer =
    error instanceof Error
    && !(error instanceof ConvexError)
    && /^(?:Photo upload failed with HTTP |Unable to download a file: response has status )429$/.test(error.message);
  return (
    error instanceof SyncUnavailableError
    || isNetworkError(error)
    || rateLimitedTransfer
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
  const { retryAfter } = error.data as { retryAfter?: unknown };
  return typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : undefined;
}

export function errorMessage(error: unknown): string {
  return convexErrorCode(error) ?? (error instanceof Error ? error.message : String(error));
}
