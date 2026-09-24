import type { FunctionReturnType } from "convex/server";

import { errorMessage } from "@/lib/network-error";

import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { DocentSentence, FactChip, RightNowCard } from "../../../convex/lib/validators";

export type ScanResult = FunctionReturnType<typeof api.scans.get>;
export type ResultCandidate = NonNullable<NonNullable<ScanResult>["best"]>;
export type ResultKind = "loading" | "confident" | "soft" | "unidentified" | "unsupported" | "failed";

export type ResultViewState = {
  kind: ResultKind;
  /** The work the card names; absent on an unidentified card, where title and artist stay blank. */
  primary?: ResultCandidate;
  runnerUps: ResultCandidate[];
  docent?: DocentSentence[];
  factSheet?: FactChip[];
  rightNow?: RightNowCard;
  editable: boolean;
  error?: string;
};

/** What the user did on the card: a runner-up they picked and the works they said were not right. */
export type ResultSelection = {
  chosenObjectId?: Id<"objects">;
  rejectedObjectIds?: Id<"objects">[];
};

function dedupe(candidates: ResultCandidate[]): ResultCandidate[] {
  const seen = new Set<Id<"objects">>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.objectId)) return false;
    seen.add(candidate.objectId);
    return true;
  });
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
  if (scan.status === "unsupported_version") {
    return {
      kind: "unsupported",
      runnerUps: [],
      editable: false,
      error: scan.error,
    };
  }
  if (scan.status === "failed") {
    return {
      kind: "failed",
      runnerUps: [],
      editable: false,
      error: scan.error,
    };
  }

  const rejected = new Set(selection.rejectedObjectIds ?? []);
  const candidates = dedupe([...(scan.best ? [scan.best] : []), ...(scan.runnerUps ?? [])]);
  const chosen = candidates.find((candidate) => candidate.objectId === selection.chosenObjectId);
  // A miss keeps its low-probability best among the suggestions rather than naming it.
  const primary = chosen ?? (scan.outcome === "miss" ? undefined : scan.best);
  const runnerUps = candidates.filter((candidate) => candidate !== primary && !rejected.has(candidate.objectId));
  const kind: ResultKind = !primary
    ? "unidentified"
    : chosen || primary.identityStatus === "tentative" || scan.outcome !== "confident"
      ? "soft"
      : "confident";
  return {
    kind,
    primary,
    runnerUps,
    editable: true,
    ...(kind === "confident"
      ? {
          docent: scan.docent,
          factSheet: scan.factSheet,
          rightNow: scan.rightNow,
        }
      : {}),
  };
}
