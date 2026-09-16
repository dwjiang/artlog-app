import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { softDeleteSavedWork } from '@/db/repos/saved-works';

type Removal = { owner: string; localId: string; title: string; status: 'undoable' | 'saving' | 'failed' };
let pending: Removal[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const key = (item: Pick<Removal, 'owner' | 'localId'>) => `${item.owner}:${item.localId}`;
function emit() { for (const listener of listeners) listener(); }
function update(item: Removal, status: Removal['status']) { pending = pending.map((row) => key(row) === key(item) ? { ...row, status } : row); emit(); }
export function undoRemoval(item: Pick<Removal, 'owner' | 'localId'>) {
  if (pending.find((row) => key(row) === key(item))?.status === 'saving') return;
  clearTimeout(timers.get(key(item))); timers.delete(key(item));
  pending = pending.filter((row) => key(row) !== key(item)); emit();
}
export async function commitRemoval(item: Removal) {
  clearTimeout(timers.get(key(item))); timers.delete(key(item));
  update(item, 'saving');
  try {
    await softDeleteSavedWork(item.localId, Date.now(), item.owner);
    pending = pending.filter((row) => key(row) !== key(item)); emit();
  } catch { update(item, 'failed'); }
}
// The toast already reports the removal, so leaving the foreground commits it instead of losing the timer with the process.
let appState: { remove: () => void } | undefined;
function commitUndoable() { for (const row of pending) if (row.status === 'undoable') void commitRemoval(row); }
export function scheduleRemoval(item: Omit<Removal, 'status'>) {
  if (pending.some((row) => key(row) === key(item))) return;
  const removal: Removal = { ...item, status: 'undoable' };
  pending = [...pending, removal]; emit();
  timers.set(key(item), setTimeout(() => { void commitRemoval(removal); }, 6000));
  appState ??= AppState.addEventListener('change', (state) => { if (state !== 'active') commitUndoable(); });
}
export function usePendingRemovals() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => pending);
}
