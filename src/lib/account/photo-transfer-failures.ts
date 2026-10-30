import { failureDetails } from "@/lib/failure-step";
import { reportError } from "@/lib/observability";

const reportedTransfers = new Set<string>();

// A photo that can never transfer fails the same way on every sweep, so each failure is reported once a session.
export function reportTransferFailure(error: unknown, kind: "crop" | "album", direction: "upload" | "download"): void {
  const failure = failureDetails(error);
  const key = `${kind}:${direction}:${failure?.step}:${error instanceof Error ? error.message : String(error)}`;
  if (reportedTransfers.has(key)) return;
  reportedTransfers.add(key);
  reportError(error, "sync.photos", { data: { kind, direction, ...failure } });
}
