import { randomUUID } from 'expo-crypto';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { insertSavedWork, markSynced } from '@/db/repos/saved-works';
import { getVisit } from '@/db/repos/visits';
import type { PendingScan } from '@/db/schema';
import { convex } from '@/lib/convex-client';
import { venueNameById } from '@/lib/venue/venue-db';
import { buildSnapshot, type SnapshotDraft } from './snapshot';
import type { ResultViewState } from './state';

export type SaveResultInput = {
  /** Absent while the scan is still queued on this phone; the server row then references no scan. */
  scanId?: Id<'scans'>;
  capture: Pick<PendingScan, 'photoPath' | 'cropPath' | 'venueId' | 'visitId' | 'visitLocalId'>;
  /** Absent when the card names no work (queued or unsupported); the snapshot is then whatever the user typed. */
  view?: ResultViewState;
  draft: SnapshotDraft;
};

export type SaveResultOutcome = {
  localId: string;
  /** The server copy; it never rejects, a failed sync is logged and left to the sync path (plan 04.11). */
  synced: Promise<void>;
};

/** Saves locally first (design §5.1), then mirrors the row to the collection on the server. */
export async function saveResult({ scanId, capture, view, draft }: SaveResultInput): Promise<SaveResultOutcome> {
  const { snapshot, suggested } = buildSnapshot(draft, view);
  if (!snapshot.title) throw new Error('A title is required to save');
  const visit = capture.visitLocalId ? await getVisit(capture.visitLocalId) : undefined;
  const venueId = capture.venueId ?? visit?.venueId;
  const venueName = visit?.venueName ?? (venueId ? await venueNameById(venueId).catch(() => undefined) : undefined);
  const visitId = capture.visitId ?? visit?.remoteVisitId ?? undefined;
  const primary = view?.primary;
  const localId = randomUUID();
  await insertSavedWork({
    localId, savedAt: Date.now(), ...snapshot,
    visitLocalId: visit?.localId, venueId, venueName, gallery: primary?.gallery,
    objectId: primary?.objectId, artworkId: primary?.artworkId, scanId,
    photoPath: capture.photoPath, cropPath: capture.cropPath,
  });
  const synced = convex.mutation(api.collections.saveToCollection, {
    localId, scanId, objectId: primary?.objectId, artworkId: primary?.artworkId, venueId, visitId,
    gallery: primary?.gallery, snapshot, suggested,
  }).then(
    () => markSynced([localId], Date.now()),
    (error: unknown) => { console.warn('Could not sync the saved work; it stays on the phone', error); },
  );
  return { localId, synced };
}
