import type { Href } from "expo-router";

import type { Id } from "../../../convex/_generated/dataModel";
import type { ReportReason, ReportTarget } from "./types";

export type ReportKind = ReportTarget["kind"];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam or scam",
  harassment: "Harassment or hate",
  impersonation: "Pretending to be someone else",
  privacy: "Shares private information",
  other: "Something else",
};

/** Each kind lists the reasons that fit it, most common first; "other" stays last. */
export const REPORT_REASONS: Record<ReportKind, ReportReason[]> = {
  profile: ["spam", "impersonation", "harassment", "other"],
  wallItem: ["spam", "harassment", "other"],
  sharedVisit: ["harassment", "privacy", "spam", "other"],
  comment: ["harassment", "spam", "privacy", "other"],
};

export const REPORT_NOUNS: Record<ReportKind, string> = {
  profile: "profile",
  wallItem: "artwork",
  sharedVisit: "visit",
  comment: "comment",
};

export function reportHref(kind: ReportKind, id: string): Href {
  return { pathname: "/report", params: { kind, id } };
}

export function reportTarget(kind: string | undefined, id: string | undefined): ReportTarget | undefined {
  if (!id) return;
  switch (kind) {
    case "profile":
      return { kind, profileId: id as Id<"profiles"> };
    case "wallItem":
      return { kind, itemId: id as Id<"wallItems"> };
    case "sharedVisit":
      return { kind, postId: id };
    case "comment":
      return { kind, commentId: id as Id<"visitComments"> };
  }
}
