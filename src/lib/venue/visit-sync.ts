import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { getNextVisitToSync, getVisit, patchVisit } from '@/db/repos/visits';
import { convex } from '@/lib/convex-client';

/** Serializes starts and ends so revisiting a museum cannot resume a visit already ended locally. */
export function createVisitSync(): () => Promise<void> {
  let inFlight: Promise<void> | undefined;
  let requested = false;

  async function drain(): Promise<void> {
    do {
      requested = false;
      let visit = await getNextVisitToSync();
      while (visit) {
        let remoteVisitId = visit.remoteVisitId;
        if (!remoteVisitId) {
          const { visitId } = await convex.mutation(api.visits.startVisit, { venueId: visit.venueId, localVisitId: visit.localId });
          remoteVisitId = visitId;
          await patchVisit(visit.localId, { remoteVisitId });
        }
        // Location and dismissal keep working while a server request is pending.
        const current = await getVisit(visit.localId);
        if (current && current.endedAt !== null) {
          await convex.mutation(api.visits.endVisit, { visitId: remoteVisitId });
          await patchVisit(visit.localId, { endSyncedAt: Date.now() });
        }
        visit = await getNextVisitToSync();
      }
    } while (requested);
  }

  function sync(): Promise<void> {
    requested = true;
    inFlight ??= drain().catch((error: unknown) => {
      requested = false;
      throw error;
    }).finally(() => {
      inFlight = undefined;
      if (requested) void sync().catch((error: unknown) => console.warn('Could not sync visits with the server', error));
    });
    return inFlight;
  }
  return sync;
}

export const syncVisits = createVisitSync();

export async function resolveScanVisit(localId: string, venueId: Id<'museums'>): Promise<Id<'visits'>> {
  let visit = await getVisit(localId);
  if (!visit || visit.venueId !== venueId) throw new Error('The capture is linked to an invalid visit');
  if (!visit.remoteVisitId) {
    await syncVisits();
    visit = await getVisit(localId);
  }
  if (!visit?.remoteVisitId) throw new Error('The capture visit could not be synchronized');
  return visit.remoteVisitId;
}
