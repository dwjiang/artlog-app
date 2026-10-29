import type { Href } from "expo-router";

import type { ReportKind } from "@/shared/social/contracts";

import type { Id } from "../../../convex/_generated/dataModel";
import type { ReportReason, ReportTarget } from "./types";

export type ContentReportTarget = Extract<ReportTarget, { artworkId: Id<"artworks"> } | { kind: "scanDocent" }>;

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam or scam",
  harassment: "Harassment or hate",
  impersonation: "Pretending to be someone else",
  privacy: "Shares private information",
  wrongFacts: "Wrong or made-up facts",
  wrongArtwork: "Describes a different artwork",
  offensive: "Offensive or inappropriate",
  mispronounced: "Mispronounced words",
  glitches: "Glitches or cuts off",
  mismatch: "Doesn’t match the transcript",
  copyright: "Copyright infringement",
  other: "Something else",
};

export const REPORT_NOUNS: Record<ReportKind, string> = {
  profile: "profile",
  wallItem: "artwork",
  sharedVisit: "visit",
  comment: "comment",
  docent: "description",
  scanDocent: "description",
  transcript: "transcript",
  audio: "audio",
};

/** "Report Profile" and the like, as the report menu action and its sheet title name it. */
export function reportTitle(kind: ReportKind) {
  const noun = REPORT_NOUNS[kind];
  return `Report ${noun[0].toUpperCase()}${noun.slice(1)}`;
}

export function reportHref(kind: ReportKind, id: string, renderId?: string): Href {
  return { pathname: "/report", params: { kind, id, ...(renderId ? { renderId } : {}) } };
}

export function reportTarget(
  kind: string | undefined,
  id: string | undefined,
  renderId?: string,
): ReportTarget | undefined {
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
    case "docent":
    case "transcript":
      return { kind, artworkId: id as Id<"artworks"> };
    case "scanDocent":
      return { kind, scanId: id as Id<"scans"> };
    case "audio":
      return renderId ? { kind, artworkId: id as Id<"artworks">, renderId } : undefined;
  }
}
