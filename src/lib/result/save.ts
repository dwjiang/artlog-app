import { randomUUID } from 'expo-crypto';

import { captureOwner } from '@/lib/account/owner-store';
import { flushJournal } from '@/lib/account/collection-sync';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { insertSavedWork, markSynced } from '@/db/repos/saved-works';
import { requestCollectionSync } from '@/lib/account/sync-events';
import { getVisit } from '@/db/repos/visits';
import type { PendingScan } from '@/db/schema';
import { convex } from '@/lib/convex-client';
import { venueNameById } from '@/lib/venue/venue-db';
import { buildSnapshot, type SnapshotDraft } from './snapshot';
import type { ResultViewState } from './state';

export type SaveResultInput = {
  /** Absent while the scan is still queued on this phone; the server row then references no scan. */
  scanId?: Id<'scans'>;
  capture: Pick<PendingScan, 'photoPath' | 'cropPath' | 'venueId' | 'visitId' | 'visitLocalId' | 'capturedAt' | 'owner'>;
  /** Absent when the card names no work (queued or unsupported); the snapshot is then whatever the user typed. */
  view?: ResultViewState;
  draft: SnapshotDraft;
};

export type SaveResultOutcome = {
  localId: string;
  /** Failed uploads stay queued for collection sync; the local save remains usable. */
  synced: Promise<void>;
};

/** Saves locally first, then mirrors the row to the collection on the server. */
export async function saveResult({ scanId, capture, view, draft }: SaveResultInput): Promise<SaveResultOutcome> {
  const current = captureOwner();
  if (capture.owner !== current.owner) throw new Error('Journal owner changed');
  const { snapshot, suggested } = buildSnapshot(draft, view);
  if (!snapshot.title) throw new Error('A title is required to save');
  const visit = capture.visitLocalId ? await getVisit(capture.visitLocalId, current.owner) : undefined;
  const venueId = capture.venueId ?? visit?.venueId;
  const venueName = visit?.venueName ?? (venueId ? await venueNameById(venueId).catch(() => undefined) : undefined);
  const primary = view?.primary;
  const localId = randomUUID();
  const savedAt = capture.capturedAt;
  if (!current.isCurrent()) throw new Error('Journal owner changed');
  await insertSavedWork({
    localId, savedAt, ...snapshot,
    visitLocalId: visit?.localId, venueId, venueName, gallery: primary?.gallery,
    objectId: primary?.objectId, artworkId: primary?.artworkId, scanId,
    photoPath: capture.photoPath, cropPath: capture.cropPath,
  }, current.owner);
  const synced = (async () => {
    if (!current.scope || !current.isCurrent()) return;
    await flushJournal();
    if (!current.isCurrent()) return;
    const acknowledgement = await convex.mutation(api.collections.saveToCollection, {
    localId, scanId, objectId: primary?.objectId, artworkId: primary?.artworkId, venueId, visitLocalId: visit?.localId, scope: current.scope,
    gallery: primary?.gallery, snapshot, suggested, savedAt, venueName,
    });
    if (current.isCurrent()) await markSynced([{ ...acknowledgement, localId, revision: 0 }], current.owner);
  })().catch((error: unknown) => { console.warn('Could not sync the saved work; it stays on the phone', error); }).finally(requestCollectionSync);
  return { localId, synced };
}
