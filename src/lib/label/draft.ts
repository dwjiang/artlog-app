import type { Id } from '../../../convex/_generated/dataModel';
import { getSetting, removeSetting, setSetting } from '@/db/repos/settings';
import type { LabelFormState } from './fields';

const key = (scanId: Id<'scans'>) => `labelDraft:${scanId}`;

type LabelDraft = { state: LabelFormState; museumSearchUpdatedAt?: number };

export async function loadLabelDraft(scanId: Id<'scans'>, museumSearchUpdatedAt?: number): Promise<LabelFormState | undefined> {
  const stored = await getSetting(key(scanId));
  if (stored === undefined) return;
  const draft = JSON.parse(stored) as LabelDraft;
  return draft.museumSearchUpdatedAt === museumSearchUpdatedAt ? draft.state : undefined;
}

// Keep the original values and unlocks before verification can replace the server's fields.
export function saveLabelDraft(scanId: Id<'scans'>, state: LabelFormState, museumSearchUpdatedAt?: number): Promise<void> {
  return setSetting(key(scanId), JSON.stringify({ state, museumSearchUpdatedAt } satisfies LabelDraft));
}

export function clearLabelDraft(scanId: Id<'scans'>): Promise<void> {
  return removeSetting(key(scanId));
}
