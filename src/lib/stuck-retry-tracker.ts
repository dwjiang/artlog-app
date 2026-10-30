import { isNetworkError, isTransientError } from "./network-error";

const STUCK_FAILURES = 10;

export function createStuckRetryTracker() {
  let failures = 0;
  return {
    recordFailure(error: unknown): boolean {
      if (failures >= STUCK_FAILURES || !isTransientError(error) || isNetworkError(error)) return false;
      failures++;
      return failures === STUCK_FAILURES;
    },
    reset(): void {
      failures = 0;
    },
  };
}
