import type { Id } from '../../../convex/_generated/dataModel';
import { getSetting, removeSetting, setSetting } from '@/db/repos/settings';
import type { LabelFormState } from './fields';

const key = (scanId: Id<'scans'>) => `labelDraft:${scanId}`;

export async function loadLabelDraft(scanId: Id<'scans'>): Promise<LabelFormState | undefined> {
  const stored = await getSetting(key(scanId));
  return stored === undefined ? undefined : JSON.parse(stored) as LabelFormState;
}

// Keep the original values and unlocks before verification can replace the server's fields.
export function saveLabelDraft(scanId: Id<'scans'>, state: LabelFormState): Promise<void> {
  return setSetting(key(scanId), JSON.stringify(state));
}

export function clearLabelDraft(scanId: Id<'scans'>): Promise<void> {
  return removeSetting(key(scanId));
}
