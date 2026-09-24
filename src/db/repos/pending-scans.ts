import { and, asc, desc, eq, getTableColumns, isNotNull, isNull, lt, ne, or } from "drizzle-orm";

import type { Id } from "../../../convex/_generated/dataModel";
import { getLocalOwner } from "../../lib/account/owner-store";
import { db } from "../client";
import {
  artworkPhotos,
  offlineScanResults,
  pendingScans,
  type NewPendingScan,
  type PendingScan,
  type PendingScanStatus,
} from "../schema";
import { requireVisitMembership } from "./visit-membership";

export const MAX_IDENTIFY_ATTEMPTS = 5;
export const MAX_LABEL_ATTEMPTS = 5;
export type PendingLabel = { labelPhotoPath?: string; qrUrl?: string };

export type ScanFeatureUpdate = Pick<PendingScan, "vector" | "descriptors" | "keypoints" | "modelVersion">;

export async function enqueuePendingScan(row: NewPendingScan, owner = getLocalOwner()): Promise<void> {
  requireVisitMembership(owner, row);
  db.insert(pendingScans)
    .values({ ...row, owner })
    .run();
}

/** The row as a query for `useLiveQuery`; `getPendingScan` reads it once. */
export function selectPendingScan(localId: string, owner = getLocalOwner()) {
  return db
    .select()
    .from(pendingScans)
    .where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)));
}

export async function getPendingScan(localId: string, owner = getLocalOwner()): Promise<PendingScan | undefined> {
  return selectPendingScan(localId, owner).get();
}

export function selectCaptureForScan(scanId: Id<"scans">, owner = getLocalOwner()) {
  return db
    .select()
    .from(pendingScans)
    .where(and(eq(pendingScans.owner, owner), eq(pendingScans.scanId, scanId)));
}

export async function getCaptureForScan(
  scanId: Id<"scans">,
  owner = getLocalOwner(),
): Promise<PendingScan | undefined> {
  return selectCaptureForScan(scanId, owner).get();
}

export function captureQuery(scanId: string, owner = getLocalOwner()) {
  return db
    .select()
    .from(pendingScans)
    .where(
      and(
        eq(pendingScans.owner, owner),
        scanId.startsWith("local-")
          ? eq(pendingScans.localId, scanId.slice("local-".length))
          : eq(pendingScans.scanId, scanId as Id<"scans">),
      ),
    )
    .limit(1);
}

export async function listPendingLabels(owner = getLocalOwner()): Promise<PendingScan[]> {
  return db
    .select()
    .from(pendingScans)
    .where(
      and(
        eq(pendingScans.owner, owner),
        eq(pendingScans.status, "identified"),
        isNotNull(pendingScans.scanId),
        or(isNotNull(pendingScans.labelPhotoPath), isNotNull(pendingScans.qrUrl)),
        lt(pendingScans.attempts, MAX_LABEL_ATTEMPTS),
      ),
    )
    .orderBy(asc(pendingScans.capturedAt), asc(pendingScans.localId));
}

function matchingLabel(localId: string, label: PendingLabel, owner: string) {
  return and(
    and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)),
    label.labelPhotoPath ? eq(pendingScans.labelPhotoPath, label.labelPhotoPath) : isNull(pendingScans.labelPhotoPath),
    label.qrUrl ? eq(pendingScans.qrUrl, label.qrUrl) : isNull(pendingScans.qrUrl),
  );
}

export async function clearPendingLabel(localId: string, label: PendingLabel, owner = getLocalOwner()): Promise<void> {
  await db
    .update(pendingScans)
    .set({ labelPhotoPath: null, qrUrl: null, attempts: 0, lastError: null })
    .where(matchingLabel(localId, label, owner));
}

export async function recordLabelFailure(
  localId: string,
  error: string,
  { countAttempt }: { countAttempt: boolean },
  owner = getLocalOwner(),
) {
  const row = await getPendingScan(localId, owner);
  // Crop correction can replace the scan while its previous request is still in flight.
  if (!row) return { status: "failed" as const, attempts: 0 };
  const attempts = row.attempts + (countAttempt ? 1 : 0);
  await db
    .update(pendingScans)
    .set({ attempts, lastError: error })
    .where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)));
  // This is the label task's retry status; identification remains complete.
  return {
    status: attempts >= MAX_LABEL_ATTEMPTS ? ("failed" as const) : ("queued" as const),
    attempts,
  };
}

export async function retryPendingLabel(localId: string, owner = getLocalOwner()): Promise<void> {
  await db
    .update(pendingScans)
    .set({ attempts: 0, lastError: null })
    .where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)));
}

/** Viewing a scan does not save it. Album tombstones keep previously saved captures out too. */
export function pendingScansQuery(owner = getLocalOwner()) {
  return db
    .select(getTableColumns(pendingScans))
    .from(pendingScans)
    .leftJoin(
      artworkPhotos,
      and(eq(artworkPhotos.owner, pendingScans.owner), eq(artworkPhotos.localId, pendingScans.localId)),
    )
    .where(and(eq(pendingScans.owner, owner), isNull(artworkPhotos.localId)))
    .orderBy(desc(pendingScans.capturedAt), desc(pendingScans.localId));
}

/** Rows the flusher should send, oldest first; a model update gives failed rows another run. */
export async function listFlushable(modelVersion: string, owner = getLocalOwner()): Promise<PendingScan[]> {
  return db
    .select()
    .from(pendingScans)
    .where(
      and(
        eq(pendingScans.owner, owner),
        or(
          eq(pendingScans.status, "queued"),
          and(eq(pendingScans.status, "failed"), ne(pendingScans.attemptModelVersion, modelVersion)),
        ),
      ),
    )
    .orderBy(asc(pendingScans.capturedAt), asc(pendingScans.localId));
}

export async function markIdentifying(localId: string, owner = getLocalOwner()): Promise<void> {
  await db
    .update(pendingScans)
    .set({ status: "identifying" })
    .where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)));
}

export async function markIdentified(localId: string, scanId: Id<"scans">, owner = getLocalOwner()): Promise<void> {
  await db
    .update(pendingScans)
    .set({ status: "identified", scanId, attempts: 0, lastError: null })
    .where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)));
}

export async function markFailed(
  localId: string,
  error: string,
  scanId?: Id<"scans">,
  owner = getLocalOwner(),
): Promise<void> {
  await db
    .update(pendingScans)
    .set({ status: "failed", lastError: error, ...(scanId ? { scanId } : {}) })
    .where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)));
}

/** Returns the row to the queue; counted attempts give up at `MAX_IDENTIFY_ATTEMPTS`. */
export async function recordAttemptFailure(
  localId: string,
  error: string,
  { countAttempt }: { countAttempt: boolean },
  owner = getLocalOwner(),
): Promise<{ status: PendingScanStatus; attempts: number }> {
  const row = await getPendingScan(localId, owner);
  if (!row) return { status: "failed" as const, attempts: 0 };
  const attempts = row.attempts + (countAttempt ? 1 : 0);
  const status: PendingScanStatus = attempts >= MAX_IDENTIFY_ATTEMPTS ? "failed" : "queued";
  await db
    .update(pendingScans)
    .set({ status, attempts, lastError: error })
    .where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)));
  return { status, attempts };
}

/** No identify call survives a process restart: rows left `identifying` go back to the queue. */
export async function requeueInterrupted(owner = getLocalOwner()): Promise<void> {
  await db
    .update(pendingScans)
    .set({ status: "queued" })
    .where(and(eq(pendingScans.owner, owner), eq(pendingScans.status, "identifying")));
}

export async function retryPendingScan(localId: string, owner = getLocalOwner()): Promise<void> {
  await db
    .update(pendingScans)
    .set({ status: "queued", attempts: 0, lastError: null })
    .where(
      and(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)), eq(pendingScans.status, "failed")),
    );
}

export async function resetAttemptsForModel(
  localId: string,
  attemptModelVersion: string,
  owner = getLocalOwner(),
): Promise<void> {
  await db
    .update(pendingScans)
    .set({
      attemptModelVersion,
      status: "queued",
      attempts: 0,
      lastError: null,
    })
    .where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)));
}

export async function updateFeatures(
  localId: string,
  features: ScanFeatureUpdate,
  owner = getLocalOwner(),
): Promise<void> {
  await db
    .delete(offlineScanResults)
    .where(and(eq(offlineScanResults.owner, owner), eq(offlineScanResults.localId, localId)));
  await db
    .update(pendingScans)
    .set({
      ...features,
      attemptModelVersion: features.modelVersion,
      status: "queued",
      attempts: 0,
      lastError: null,
    })
    .where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)));
}

export async function setLabelPhoto(localId: string, labelPhotoPath: string, owner = getLocalOwner()): Promise<void> {
  await db
    .update(pendingScans)
    .set({ labelPhotoPath, qrUrl: null, attempts: 0, lastError: null })
    .where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)));
}

export async function setQrUrl(localId: string, qrUrl: string, owner = getLocalOwner()): Promise<void> {
  await db
    .update(pendingScans)
    .set({ qrUrl, labelPhotoPath: null, attempts: 0, lastError: null })
    .where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)));
}

export async function deletePendingScan(localId: string, owner = getLocalOwner()): Promise<void> {
  await db.delete(pendingScans).where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)));
}
