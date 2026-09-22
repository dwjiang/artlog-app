import { reportError } from '@/lib/observability';
import type { CaptureCompletion } from '../capture/completion';
import { formatVisitDate } from '../journal/history';
import { randomUUID } from 'expo-crypto';

import { captureOwner } from '@/lib/account/owner-store';
import { flushJournal } from '@/lib/account/collection-sync';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { getSavedWork, listSavedWorks, markSynced } from '@/db/repos/saved-works';
import { findArtworkPhoto, saveArtworkSession, selectArtworkPhotos } from '@/db/repos/artwork-album';
import { clearPhotoDraft, readPhotoDraft, readPhotoSession } from '../capture/photo-draft';
import { requestCollectionSync } from '@/lib/account/sync-events';
import { getVisit } from '@/db/repos/visits';
import type { PendingScan, Visit } from '@/db/schema';
import { convex } from '@/lib/convex-client';
import { visitForSave } from '@/lib/venue/use-venue';
import { venueNameById } from '@/lib/venue/venue-db';
import { captureVisitChoice } from '../capture/visit-choice';
import { scanPreviewPath } from '@/lib/files/photos';
import type { ContributeInput } from '../label/contribute';
import { shareSavedLabel, type ContributionAttempt } from '../label/share-saved-label';
import { buildSnapshot, type SnapshotDraft } from './snapshot';
import type { ResultViewState } from './state';

export type SaveResultInput = {
  /** Absent while the scan is still queued on this phone; the server row then references no scan. */
  scanId?: Id<'scans'>;
  capture: Pick<PendingScan, 'localId' | 'photoPath' | 'cropPath' | 'venueId' | 'visitId' | 'visitLocalId' | 'capturedAt' | 'owner'>;
  /** Absent when the card names no work (queued or unsupported); the snapshot is then whatever the user typed. */
  view?: ResultViewState;
  draft: SnapshotDraft;
  contribution?: ContributeInput;
};

export type SaveResultOutcome = {
  localId: string;
  completion: CaptureCompletion;
  /** Failed uploads stay queued for collection sync; the local save remains usable. */
  synced: Promise<void>;
  contribution?: Promise<ContributionAttempt>;
};

const ACTIONABLE = new Set(['Review your added photos before saving.', 'Choose an available visit before saving.']);
/** Failures the person can resolve keep their message; anything else is a retry prompt. */
export function saveErrorMessage(cause: unknown): string {
  return cause instanceof Error && ACTIONABLE.has(cause.message) ? cause.message : 'Couldn’t save. Try again.';
}

type LinkedVisit = Pick<Visit, 'localId' | 'venueId' | 'venueName' | 'visitedOn' | 'remoteVisitId'>;

/** Saves locally first, then mirrors the row to the collection on the server. */
export async function saveResult({ scanId, capture, view, draft, contribution }: SaveResultInput): Promise<SaveResultOutcome> {
  const current = captureOwner();
  if (capture.owner !== current.owner) throw new Error('Journal owner changed');
  const { snapshot, suggested } = buildSnapshot(draft, view);
  if (!snapshot.title) snapshot.title = 'Unidentified artwork';
  if (readPhotoDraft(current.owner, capture.photoPath).some((photo) => photo.review)) throw new Error('Review your added photos before saving.');
  const session = readPhotoSession(current.owner, capture.photoPath);
  const choice = captureVisitChoice(capture, session);
  let visit: LinkedVisit | undefined;
  if (choice.kind === 'visit') {
    visit = await getVisit(choice.localId, current.owner);
    if (!visit) throw new Error(session.visit ? 'Choose an available visit before saving.' : 'The capture is linked to an invalid visit');
  } else if (choice.kind === 'venue') {
    // The first save at a museum starts its visit, dated by the shutter; later saves join it.
    const started = await visitForSave(choice.venueId, capture.capturedAt);
    visit = { ...started, remoteVisitId: started.remoteVisitId ?? null };
  }
  if (!current.isCurrent()) throw new Error('Journal owner changed');
  if (!session.visit && capture.visitLocalId != null && visit &&
    (visit.venueId !== capture.venueId || (capture.visitId != null && visit.remoteVisitId !== capture.visitId))) {
    throw new Error('The capture is linked to an invalid visit');
  }
  // A save with no visit by default (the visit there ended by hand today) keeps its museum; only a draft's "No visit" drops it.
  const venueId = visit?.venueId ?? (session.visit ? undefined : capture.venueId ?? undefined);
  const venueName = visit?.venueName ?? (venueId ? await venueNameById(venueId).catch((error: unknown) => { reportError(error, 'result.resolve_venue', { level: 'warning' }); return undefined; }) : undefined);
  // The scan was identified at the capture's museum, in its visit when one was open; the server confirms it only under that context.
  const contextChanged = venueId !== (capture.venueId ?? undefined) || (capture.visitLocalId != null && visit?.localId !== capture.visitLocalId);
  const confirmationScanId = contextChanged ? undefined : scanId;
  capture = { ...capture, visitLocalId: visit?.localId ?? null, visitId: visit?.remoteVisitId ?? null, venueId: venueId ?? null };
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
  const photos = selectArtworkPhotos(localId, current.owner).all();
  const additional = readPhotoDraft(current.owner, capture.photoPath).map((photo) => ({ ...photo, savedLocalId: localId, visitLocalId: visit?.localId }));
  if (!photos.some((photo) => photo.path === capture.photoPath)) additional.unshift({ localId: captured ? randomUUID() : capture.localId, savedLocalId: localId,
    path: capture.photoPath, kind: session.primaryKind ?? captured?.kind ?? 'full', capturedAt: capture.capturedAt, visitLocalId: visit?.localId });
  saveArtworkSession(localId, existing ? undefined : { localId, savedAt, ...snapshot,
    visitLocalId: visit?.localId, venueId, venueName, gallery: primary?.gallery,
    objectId: primary?.objectId, artworkId: primary?.artworkId, scanId,
    photoPath: capture.photoPath, cropPath: scanPreviewPath(capture.cropPath) }, additional, visit?.localId, current.owner);
  clearPhotoDraft(current.owner, capture.photoPath);
  const synced = (async () => {
    if (!current.scope || !current.isCurrent()) return;
    // A failed flush only matters while the visit is still local; saveToCollection reports that itself.
    await flushJournal().catch(() => {});
    if (!current.isCurrent()) return;
    if (existing) return;
    const acknowledgement = await convex.mutation(api.collections.saveToCollection, {
    localId, scanId: confirmationScanId, objectId: primary?.objectId, artworkId: primary?.artworkId, venueId, visitLocalId: visit?.localId, scope: current.scope,
    gallery: primary?.gallery, snapshot, suggested: contextChanged ? null : suggested, savedAt, venueName,
    });
    if (current.isCurrent()) await markSynced([{ ...acknowledgement, localId, revision: 0 }], current.owner);
  })().catch((error: unknown) => { reportError(error, 'result.sync'); console.warn('Could not sync the saved work; it stays on the phone', error); }).finally(requestCollectionSync);
  return { localId, synced, contribution: contribution && !contextChanged ? shareSavedLabel(contribution, localId) : undefined,
    completion: { savedId: localId, title: existing?.title ?? snapshot.title, wasExisting: !!existing,
    photoPaths: additional.map((photo) => photo.path), visitLabel: visit ? `${visit.venueName} · ${formatVisitDate(visit.visitedOn)}` : 'No visit · Collection only' } };
}
