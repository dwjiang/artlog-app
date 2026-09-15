import { calendarDate, isTimestamp } from '../../../shared/journal/limits';
import { getVisit, patchVisit } from '../../db/repos/visits';
import { captureOwner } from '../account/owner-store';
import type { VenueContext } from '../venue/venue-reducer';

/** Checks the visit a scan is linked to and backdates it to the shutter; a venue-only context passes through. */
export async function prepareCaptureVisit(context: VenueContext, capturedAt: number): Promise<VenueContext> {
  if (!isTimestamp(capturedAt)) throw new Error('Invalid capture date');
  if (context.visitLocalId === undefined && context.visitId === undefined) return context;
  const current = captureOwner();
  const visit = context.visitLocalId ? await getVisit(context.visitLocalId, current.owner) : undefined;
  if (!current.isCurrent()) throw new Error('Journal owner changed');
  if (!visit || visit.venueId !== context.venueId || context.visitId !== undefined && visit.remoteVisitId !== context.visitId) {
    throw new Error('The capture is linked to an invalid visit');
  }
  // Location resolution can finish after the shutter, including across local midnight.
  if (visit.startedAt !== null && capturedAt < visit.startedAt) {
    await patchVisit(visit.localId, { startedAt: capturedAt, visitedOn: calendarDate(capturedAt, visit.timeZone) }, current.owner);
  }
  return { venueId: visit.venueId, visitLocalId: visit.localId, visitId: visit.remoteVisitId ?? undefined };
}
