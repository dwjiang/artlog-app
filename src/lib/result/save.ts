import { randomUUID } from 'expo-crypto';

import { captureOwner } from '@/lib/account/owner-store';
import { flushJournal } from '@/lib/account/collection-sync';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { getSavedWork, listSavedWorks, markSynced } from '@/db/repos/saved-works';
import { findArtworkPhoto, saveArtworkSession, selectArtworkPhotos } from '@/db/repos/artwork-album';
import { clearPhotoDraft, readPhotoDraft } from '../capture/photo-draft';
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
  capture: Pick<PendingScan, 'localId' | 'photoPath' | 'cropPath' | 'venueId' | 'visitId' | 'visitLocalId' | 'capturedAt' | 'owner'>;
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
  if (!snapshot.title) snapshot.title = 'Unidentified artwork';
  const visit = capture.visitLocalId ? await getVisit(capture.visitLocalId, current.owner) : undefined;
  if (capture.visitLocalId != null && (!visit || visit.venueId !== capture.venueId) ||
    capture.visitId != null && (!visit || visit.remoteVisitId !== capture.visitId)) {
    throw new Error('The capture is linked to an invalid visit');
  }
  const venueId = capture.venueId ?? visit?.venueId;
  const venueName = visit?.venueName ?? (venueId ? await venueNameById(venueId).catch(() => undefined) : undefined);
  const primary = view?.primary;
  // The capture's album row carries the scan's id, so saving the same scan twice lands on the same artwork.
  const captured = findArtworkPhoto(capture.localId, current.owner);
  const saved = captured?.deletedAt === null ? await getSavedWork(captured.savedLocalId, current.owner) : undefined;
  const existing = saved?.deletedAt === null ? saved : view?.kind === 'confident' && primary?.objectId
    ? (await listSavedWorks(current.owner)).find((work) => work.objectId === primary.objectId && work.title === snapshot.title && work.artist === snapshot.artist)
    : undefined;
  const localId = existing?.localId ?? randomUUID();
  const savedAt = capture.capturedAt;
  if (!current.isCurrent()) throw new Error('Journal owner changed');
  if (readPhotoDraft(current.owner, capture.photoPath).some((photo) => photo.review)) throw new Error('Review your added photos before saving.');
  const photos = selectArtworkPhotos(localId, current.owner).all();
  const additional = readPhotoDraft(current.owner, capture.photoPath).map((photo) => ({ ...photo, savedLocalId: localId, visitLocalId: visit?.localId }));
  if (!photos.some((photo) => photo.path === capture.photoPath)) additional.unshift({ localId: captured ? randomUUID() : capture.localId, savedLocalId: localId,
    path: capture.photoPath, kind: 'full', capturedAt: capture.capturedAt, visitLocalId: visit?.localId });
  saveArtworkSession(localId, existing ? undefined : { localId, savedAt, ...snapshot,
    visitLocalId: visit?.localId, venueId, venueName, gallery: primary?.gallery,
    objectId: primary?.objectId, artworkId: primary?.artworkId, scanId,
    photoPath: capture.photoPath, cropPath: capture.cropPath }, additional, visit?.localId, current.owner);
  clearPhotoDraft(current.owner, capture.photoPath);
  const synced = (async () => {
    if (!current.scope || !current.isCurrent()) return;
    // A failed flush only matters while the visit is still local; saveToCollection reports that itself.
    await flushJournal().catch(() => {});
    if (!current.isCurrent()) return;
    if (existing) return;
    const acknowledgement = await convex.mutation(api.collections.saveToCollection, {
    localId, scanId, objectId: primary?.objectId, artworkId: primary?.artworkId, venueId, visitLocalId: visit?.localId, scope: current.scope,
    gallery: primary?.gallery, snapshot, suggested, savedAt, venueName,
    });
    if (current.isCurrent()) await markSynced([{ ...acknowledgement, localId, revision: 0 }], current.owner);
  })().catch((error: unknown) => { console.warn('Could not sync the saved work; it stays on the phone', error); }).finally(requestCollectionSync);
  return { localId, synced };
}
