import type { Id } from '../../convex/_generated/dataModel';
import type { MuseumEntry, OfflineResult } from './types';
import { decodeOrbFeatures } from '../orb/features';
import { MAX_CANDIDATES, runPipeline } from '../../convex/lib/identifyPipeline';
import model from '../model/model-version.json';

type ResultCandidate = NonNullable<OfflineResult['best']>;

export function similarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return -1;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
}
export function rankEntries(vector: number[], entries: MuseumEntry[], previous: MuseumEntry[] = []): MuseumEntry[] {
  const matches = new Map(previous.map(entry => [entry.candidate.object._id, entry]));
  for (const entry of entries) {
    const score = Math.max(...entry.vectors.map(reference => similarity(vector, reference)));
    const previous = matches.get(entry.candidate.object._id);
    if (!previous || score > previous.candidate.similarity) matches.set(entry.candidate.object._id, { vectors: [], candidate: { ...entry.candidate, similarity: score } });
  }
  return [...matches.values()].sort((a, b) => b.candidate.similarity - a.candidate.similarity).slice(0, MAX_CANDIDATES);
}
export function recognizeEntries(payload: { modelVersion: string; descriptors: ArrayBuffer; keypoints: ArrayBuffer; venueId?: Id<'museums'> }, entries: MuseumEntry[]): OfflineResult | undefined {
  if (payload.modelVersion !== model.modelVersion || !entries.length) return;
  const { decision, verifications } = runPipeline({ query: decodeOrbFeatures(payload.descriptors, payload.keypoints),
    candidates: entries.map(entry => entry.candidate), venueId: payload.venueId, now: Date.now(), inputSize: model.inputSize });
  if (decision.outcome !== 'confident' || !decision.best) return;
  const display = ({ candidate, probability }: NonNullable<typeof decision.best>): ResultCandidate => ({
    objectId: candidate.object._id, artworkId: candidate.artwork._id, probability,
    identityStatus: candidate.object.identityStatus, rightsStatus: candidate.artwork.rightsStatus,
    title: candidate.artwork.title, artist: candidate.artwork.artist, date: candidate.artwork.date,
    medium: candidate.object.medium, institution: candidate.institution,
    gallery: candidate.placement?.venueId === payload.venueId ? candidate.placement?.gallery : undefined,
  });
  const artwork = decision.best.candidate.artwork;
  const verification = verifications.get(decision.best.candidate.object._id);
  const best = { ...display(decision.best), corners: verification?.verified ? verification.corners ?? undefined : undefined };
  return { outcome: 'confident', best, runnerUps: decision.runnerUps.map(display),
    calibratorVersion: decision.calibratorVersion, docent: artwork.docent, factSheet: artwork.factSheet };
}
