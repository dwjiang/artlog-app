import { getSetting, setSetting } from '@/db/repos/settings';
import { getVisit } from '@/db/repos/visits';
import { captureOwner, getLocalOwner } from '../account/owner-store';

type Context = { venueId?: import('../../../convex/_generated/dataModel').Id<'museums'>; visitId?: import('../../../convex/_generated/dataModel').Id<'visits'>; visitLocalId?: string };
export const captureVisitKey = (owner: string) => `captureVisit:${owner}`;
export async function setCaptureVisit(value: string, owner = getLocalOwner()) { await setSetting(captureVisitKey(owner), value); }
export async function resolveCaptureVisit(fallback: () => Promise<Context>): Promise<Context> {
  const session = captureOwner();
  const selected = await getSetting(captureVisitKey(session.owner));
  if (!session.isOwnerCurrent()) throw new Error('Journal owner changed');
  if (!selected || selected === 'auto') return fallback();
  if (selected === 'none') return {};
  const visit = await getVisit(selected, session.owner);
  if (!visit || !session.isOwnerCurrent()) throw new Error('Choose an available visit before scanning');
  return { venueId: visit.venueId, visitId: visit.remoteVisitId ?? undefined, visitLocalId: visit.localId };
}
