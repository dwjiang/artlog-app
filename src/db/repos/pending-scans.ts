import { and, asc, eq, inArray, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';

import type { Id } from '../../../convex/_generated/dataModel';
import { db } from '../client';
import { pendingScans, type NewPendingScan, type PendingScan, type PendingScanStatus } from '../schema';

export const MAX_IDENTIFY_ATTEMPTS = 5;
export const MAX_LABEL_ATTEMPTS = 5;
export type PendingLabel = { labelPhotoPath?: string; qrUrl?: string };

export type ScanFeatureUpdate = Pick<PendingScan, 'vector' | 'descriptors' | 'keypoints' | 'modelVersion'>;

export async function enqueuePendingScan(row: NewPendingScan): Promise<void> {
  await db.insert(pendingScans).values(row);
}

export async function getPendingScan(localId: string): Promise<PendingScan | undefined> {
  return db.select().from(pendingScans).where(eq(pendingScans.localId, localId)).get();
}

export async function getCaptureForScan(scanId: Id<'scans'>): Promise<PendingScan | undefined> {
  return db.select().from(pendingScans).where(eq(pendingScans.scanId, scanId)).get();
}

export function captureQuery(scanId: string) {
  return db.select().from(pendingScans).where(scanId.startsWith('local-')
    ? eq(pendingScans.localId, scanId.slice('local-'.length))
    : eq(pendingScans.scanId, scanId as Id<'scans'>)).limit(1);
}

export async function listPendingLabels(): Promise<PendingScan[]> {
  return db.select().from(pendingScans).where(and(
    eq(pendingScans.status, 'identified'), isNotNull(pendingScans.scanId),
    or(isNotNull(pendingScans.labelPhotoPath), isNotNull(pendingScans.qrUrl)),
    lt(pendingScans.attempts, MAX_LABEL_ATTEMPTS),
  )).orderBy(asc(pendingScans.capturedAt));
}

function matchingLabel(localId: string, label: PendingLabel) {
  return and(eq(pendingScans.localId, localId),
    label.labelPhotoPath ? eq(pendingScans.labelPhotoPath, label.labelPhotoPath) : isNull(pendingScans.labelPhotoPath),
    label.qrUrl ? eq(pendingScans.qrUrl, label.qrUrl) : isNull(pendingScans.qrUrl));
}

export async function clearPendingLabel(localId: string, label: PendingLabel): Promise<void> {
  await db.update(pendingScans).set({ labelPhotoPath: null, qrUrl: null, attempts: 0, lastError: null })
    .where(matchingLabel(localId, label));
}

export async function recordLabelFailure(localId: string, error: string, { countAttempt }: { countAttempt: boolean }) {
  const row = await getPendingScan(localId);
  if (!row) throw new Error(`Pending scan ${localId} not found`);
  const attempts = row.attempts + (countAttempt ? 1 : 0);
  await db.update(pendingScans).set({ attempts, lastError: error }).where(eq(pendingScans.localId, localId));
  // This is the label task's retry status; identification remains complete.
  return { status: attempts >= MAX_LABEL_ATTEMPTS ? 'failed' as const : 'queued' as const, attempts };
}

export async function retryPendingLabel(localId: string): Promise<void> {
  await db.update(pendingScans).set({ attempts: 0, lastError: null }).where(eq(pendingScans.localId, localId));
}

/** Rows the user still waits on, oldest first: queued, identifying and failed. */
export function pendingScansQuery() {
  return db.select().from(pendingScans)
    .where(inArray(pendingScans.status, ['queued', 'identifying', 'failed']))
    .orderBy(asc(pendingScans.capturedAt));
}

/** Rows the flusher should send, oldest first; a model update gives failed rows another run. */
export async function listFlushable(modelVersion: string): Promise<PendingScan[]> {
  return db.select().from(pendingScans)
    .where(or(
      eq(pendingScans.status, 'queued'),
      and(eq(pendingScans.status, 'failed'), ne(pendingScans.attemptModelVersion, modelVersion)),
    ))
    .orderBy(asc(pendingScans.capturedAt));
}

export async function markIdentifying(localId: string): Promise<void> {
  await db.update(pendingScans).set({ status: 'identifying' }).where(eq(pendingScans.localId, localId));
}

export async function markIdentified(localId: string, scanId: Id<'scans'>): Promise<void> {
  await db.update(pendingScans).set({ status: 'identified', scanId, attempts: 0, lastError: null }).where(eq(pendingScans.localId, localId));
}

export async function markFailed(localId: string, error: string, scanId?: Id<'scans'>): Promise<void> {
  await db.update(pendingScans).set({ status: 'failed', lastError: error, ...(scanId ? { scanId } : {}) })
    .where(eq(pendingScans.localId, localId));
}

/** Returns the row to the queue; counted attempts give up at `MAX_IDENTIFY_ATTEMPTS`. */
export async function recordAttemptFailure(
  localId: string,
  error: string,
  { countAttempt }: { countAttempt: boolean },
): Promise<{ status: PendingScanStatus; attempts: number }> {
  const row = await getPendingScan(localId);
  if (!row) throw new Error(`Pending scan ${localId} not found`);
  const attempts = row.attempts + (countAttempt ? 1 : 0);
  const status: PendingScanStatus = attempts >= MAX_IDENTIFY_ATTEMPTS ? 'failed' : 'queued';
  await db.update(pendingScans).set({ status, attempts, lastError: error }).where(eq(pendingScans.localId, localId));
  return { status, attempts };
}

/** No identify call survives a process restart: rows left `identifying` go back to the queue. */
export async function requeueInterrupted(): Promise<void> {
  await db.update(pendingScans).set({ status: 'queued' }).where(eq(pendingScans.status, 'identifying'));
}

export async function retryPendingScan(localId: string): Promise<void> {
  await db.update(pendingScans).set({ status: 'queued', attempts: 0, lastError: null })
    .where(and(eq(pendingScans.localId, localId), eq(pendingScans.status, 'failed')));
}

export async function resetAttemptsForModel(localId: string, attemptModelVersion: string): Promise<void> {
  await db.update(pendingScans).set({ attemptModelVersion, status: 'queued', attempts: 0, lastError: null })
    .where(eq(pendingScans.localId, localId));
}

export async function updateFeatures(localId: string, features: ScanFeatureUpdate): Promise<void> {
  await db.update(pendingScans).set({ ...features, attemptModelVersion: features.modelVersion, status: 'queued', attempts: 0, lastError: null })
    .where(eq(pendingScans.localId, localId));
}

export async function setLabelPhoto(localId: string, labelPhotoPath: string): Promise<void> {
  await db.update(pendingScans).set({ labelPhotoPath, qrUrl: null, attempts: 0, lastError: null }).where(eq(pendingScans.localId, localId));
}

export async function setQrUrl(localId: string, qrUrl: string): Promise<void> {
  await db.update(pendingScans).set({ qrUrl, labelPhotoPath: null, attempts: 0, lastError: null }).where(eq(pendingScans.localId, localId));
}

export async function deletePendingScan(localId: string): Promise<void> {
  await db.delete(pendingScans).where(eq(pendingScans.localId, localId));
}
