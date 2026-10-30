export type FailureDetails = { step: string } & Record<string, string | number | boolean>;

// Keyed by the thrown error, so a caller can report where it failed without wrapping the error it shows or rethrows.
const failures = new WeakMap<object, FailureDetails>();

/** Records where `error` was thrown; the innermost step that tags an error keeps it. */
export function tagFailure(error: unknown, details: FailureDetails): void {
  if (error && typeof error === "object" && !failures.has(error)) failures.set(error, details);
}

export function failureDetails(error: unknown): FailureDetails | undefined {
  return error && typeof error === "object" ? failures.get(error) : undefined;
}
