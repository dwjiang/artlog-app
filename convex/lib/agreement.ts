import type { Doc, Id } from "../_generated/dataModel";
import { normalizeAccession } from "./museumWorkIdentity";
import { normalizeText } from "./textMatch";
import type { ContributionField, EvidenceKind } from "./validators";

// The museum's page, not the visitor, named the work. `tavily+image` qualifies because
// the phone confirmed the page's own image against the scan by embedding and homography.
export const STRONG_EVIDENCE: ReadonlySet<EvidenceKind> = new Set(["accession", "qr", "tavily+image"]);
export const AGREEMENT_MIN_COSINE = 0.9;
// An exact-duplicate embedding is a replay, not an independent scan.
export const REPLAY_COSINE = 0.999;

export type AgreementContribution = {
  _id: Id<"contributions">;
  deviceId: Id<"devices">;
  venueId: Id<"museums">;
  modelVersion: string;
  vector: number[];
  fields: {
    title: ContributionField;
    artist: ContributionField;
    accession?: ContributionField;
  };
  evidence: EvidenceKind[];
  createdAt: number;
};

export function workKey(fields: AgreementContribution["fields"]): string {
  return `${normalizeText(fields.title.value)}\n${normalizeText(fields.artist.value)}`;
}

// One label at one venue; entries of different model versions share the group and are told apart by compatibleAnchor.
export function contributionGroup(row: Pick<Doc<"contributions">, "venueId" | "fields">): string {
  return JSON.stringify([row.venueId, workKey(row.fields)]);
}

export function verifiedAccession(contribution: Pick<AgreementContribution, "fields">): string | undefined {
  const { accession } = contribution.fields;
  // Museum search confirms the page image on title/artist; its other page fields retain `tavily`.
  const confirmedPage =
    accession?.evidence === "tavily"
    && contribution.fields.title.evidence === "tavily+image"
    && contribution.fields.artist.evidence === "tavily+image";
  return accession && !accession.edited && (STRONG_EVIDENCE.has(accession.evidence) || confirmedPage)
    ? normalizeAccession(accession.value) || undefined
    : undefined;
}
