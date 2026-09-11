import type { Id } from '../_generated/dataModel';
import { cosine } from './cosine';
import { normalizeAccession } from './museumWorkIdentity';
import { normalizeText } from './textMatch';
import type { ContributionField, EvidenceKind } from './validators';

// Design §4.7: the museum's page, not the visitor, named the work. `tavily+image` qualifies because
// the phone confirmed the page's own image against the scan by embedding and homography (04.12).
export const STRONG_EVIDENCE: ReadonlySet<EvidenceKind> = new Set(['accession', 'qr', 'tavily+image']);
export const AGREEMENT_MIN_COSINE = 0.9;
// Design §8: an exact-duplicate embedding is a replay, not an independent scan.
export const REPLAY_COSINE = 0.999;
export const AGREEMENT_MIN_TRUST = 1.0;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AgreementContribution = {
  _id: Id<'contributions'>;
  deviceId: Id<'devices'>;
  venueId: Id<'museums'>;
  modelVersion: string;
  vector: number[];
  fields: { title: ContributionField; artist: ContributionField; accession?: ContributionField };
  evidence: EvidenceKind[];
  createdAt: number;
};

export type AgreementDevice = { trustWeight: number; banned: boolean };

export type AgreementResult = {
  promote: boolean;
  reason: 'strong' | 'agreement' | 'insufficient';
  partners: Id<'contributions'>[];
  differentDays: boolean;
};

const INSUFFICIENT: AgreementResult = { promote: false, reason: 'insufficient', partners: [], differentDays: false };

export function workKey(fields: AgreementContribution['fields']): string {
  return `${normalizeText(fields.title.value)}\n${normalizeText(fields.artist.value)}`;
}

export function hasStrongEvidence(contribution: AgreementContribution): boolean {
  return contribution.evidence.some((kind) => STRONG_EVIDENCE.has(kind)) &&
    contribution.fields.title.evidence !== 'user_edited' && contribution.fields.artist.evidence !== 'user_edited';
}

export function verifiedAccession(contribution: AgreementContribution): string | undefined {
  const accession = contribution.fields.accession;
  // Museum search confirms the page image on title/artist; its other page fields retain `tavily`.
  const confirmedPage = accession?.evidence === 'tavily' &&
    contribution.fields.title.evidence === 'tavily+image' && contribution.fields.artist.evidence === 'tavily+image';
  return accession && !accession.edited && (STRONG_EVIDENCE.has(accession.evidence) || confirmedPage)
    ? normalizeAccession(accession.value) || undefined : undefined;
}

function sameDay(a: number, b: number): boolean {
  return Math.floor(a / DAY_MS) === Math.floor(b / DAY_MS);
}

export function evaluate(
  candidate: AgreementContribution,
  others: readonly AgreementContribution[],
  devices: ReadonlyMap<Id<'devices'>, AgreementDevice>,
  knownAccession?: string,
): AgreementResult {
  const device = devices.get(candidate.deviceId);
  if (!device || device.banned) return INSUFFICIENT;
  const strong = hasStrongEvidence(candidate);
  const key = workKey(candidate.fields);
  let accession = knownAccession ?? verifiedAccession(candidate);
  const partners: AgreementContribution[] = [];
  for (const other of others) {
    if (other._id === candidate._id || other.deviceId === candidate.deviceId || other.venueId !== candidate.venueId) continue;
    if (other.modelVersion !== candidate.modelVersion || !devices.get(other.deviceId) || devices.get(other.deviceId)!.banned) continue;
    if (workKey(other.fields) !== key) continue;
    const otherAccession = verifiedAccession(other);
    if (accession && otherAccession && accession !== otherAccession) continue;
    const similarity = cosine(candidate.vector, other.vector);
    if (!(similarity >= AGREEMENT_MIN_COSINE && similarity < REPLAY_COSINE)) continue;
    if (partners.some((partner) => cosine(partner.vector, other.vector) >= REPLAY_COSINE)) continue;
    partners.push(other);
    accession ??= otherAccession;
  }
  const deviceIds = new Set([candidate.deviceId, ...partners.map((partner) => partner.deviceId)]);
  let trust = 0;
  for (const deviceId of deviceIds) trust += devices.get(deviceId)!.trustWeight;
  const agreement = partners.length > 0 && trust >= AGREEMENT_MIN_TRUST;
  if (!strong && !agreement) return INSUFFICIENT;
  return {
    promote: true, reason: strong ? 'strong' : 'agreement',
    partners: agreement ? partners.map((partner) => partner._id) : [],
    differentDays: agreement && partners.some((partner) => !sameDay(partner.createdAt, candidate.createdAt)),
  };
}
