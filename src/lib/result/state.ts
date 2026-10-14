import type { FunctionReturnType } from "convex/server";

import { errorMessage } from "@/lib/network-error";

import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ConfirmedSource, DocentSentence, DocentStatus, FactChip } from "../../../convex/lib/validators";

export type ScanResult = FunctionReturnType<typeof api.scans.get>;
export type ResultCandidate = NonNullable<NonNullable<ScanResult>["best"]>;
export type ConfirmedResult = NonNullable<NonNullable<ScanResult>["confirmed"]>;
export type ResultKind = "loading" | "confident" | "soft" | "unidentified" | "confirmed" | "unsupported" | "failed";

export type ResultViewState = {
  kind: ResultKind;
  /** The work the card names; absent on an unidentified or confirmed card. */
  primary?: ResultCandidate;
  /** The owner's own details for a work the index couldn't name; set only on a confirmed card. */
  confirmed?: ConfirmedResult;
  /** Where the owner named the catalogue work this card shows, when recognition didn't. */
  linked?: ConfirmedSource;
  runnerUps: ResultCandidate[];
  docent?: DocentSentence[];
  docentStatus?: DocentStatus;
  factSheet?: FactChip[];
  editable: boolean;
  error?: string;
};

export type ResultSelection = {
  chosenObjectId?: Id<"objects">;
};

function dedupe(candidates: ResultCandidate[]): ResultCandidate[] {
  const seen = new Set<Id<"objects">>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.objectId)) return false;
    seen.add(candidate.objectId);
    return true;
  });
}

export function selectResultCandidates(
  result: Pick<NonNullable<ScanResult>, "best" | "runnerUps" | "outcome">,
  chosenObjectId?: Id<"objects">,
) {
  const candidates = dedupe([...(result.best ? [result.best] : []), ...(result.runnerUps ?? [])]);
  const chosen = candidates.find((candidate) => candidate.objectId === chosenObjectId);
  // A miss keeps its low-probability best among the suggestions rather than naming it.
  const primary = chosen ?? (result.outcome === "miss" ? undefined : result.best);
  return {
    primary,
    runnerUps: candidates.filter((candidate) => candidate.objectId !== primary?.objectId),
  };
}

export function toResultViewState(
  scan: ScanResult | Error | undefined,
  selection: ResultSelection = {},
): ResultViewState {
  if (scan === undefined) {
    return { kind: "loading", runnerUps: [], editable: false };
  }
  if (scan instanceof Error) {
    return {
      kind: "failed",
      runnerUps: [],
      editable: false,
      error: errorMessage(scan),
    };
  }
  if (scan === null) {
    return {
      kind: "failed",
      runnerUps: [],
      editable: false,
      error: "scan_not_found",
    };
  }
  if (scan.status === "pending") {
    return { kind: "loading", runnerUps: [], editable: false };
  }
  if (scan.confirmed) {
    return {
      kind: "confirmed",
      confirmed: scan.confirmed,
      runnerUps: [],
      editable: true,
      docent: scan.docent,
      docentStatus: scan.docentStatus,
      factSheet: scan.factSheet,
    };
  }
  if (!scan.linked && scan.status === "unsupported_version") {
    return {
      kind: "unsupported",
      runnerUps: [],
      editable: false,
      error: scan.error,
    };
  }
  if (!scan.linked && scan.status === "failed") {
    return {
      kind: "failed",
      runnerUps: [],
      editable: false,
      error: scan.error,
    };
  }

  const chosenObjectId = scan.linked ? undefined : selection.chosenObjectId;
  const { primary, runnerUps } = selectResultCandidates(scan, chosenObjectId);
  const kind: ResultKind = !primary
    ? "unidentified"
    : primary.objectId === chosenObjectId || primary.identityStatus === "tentative" || scan.outcome !== "confident"
      ? "soft"
      : "confident";
  return {
    kind,
    primary,
    runnerUps,
    linked: scan.linked?.source,
    editable: true,
    ...(kind === "confident"
      ? {
          docent: scan.docent,
          docentStatus: scan.docentStatus,
          factSheet: scan.factSheet,
        }
      : {}),
  };
}
