import { reportError } from '@/lib/observability';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { softDeleteSavedWork } from '@/db/repos/saved-works';

type Removal = { owner: string; localId: string; title: string; status: 'undoable' | 'saving' | 'failed' };
type RemovedWork = Pick<Removal, 'owner' | 'localId'>;
let pending: Removal[] = [];
// Session tombstones prevent independent live queries from restoring a save before their SQLite notifications arrive.
const committed = new Map<string, RemovedWork>();
let hidden: RemovedWork[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const key = (item: Pick<Removal, 'owner' | 'localId'>) => `${item.owner}:${item.localId}`;
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function emit() {
  hidden = [...committed.values(), ...pending.filter((item) => item.status !== 'failed')];
  for (const listener of listeners) listener();
}
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
    committed.set(key(item), { owner: item.owner, localId: item.localId });
    pending = pending.filter((row) => key(row) !== key(item)); emit();
  } catch (cause) { reportError(cause, 'collection.remove'); update(item, 'failed'); }
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
  return useSyncExternalStore(subscribe, () => pending);
}
export function useRemovedWorkIds(owner: string) {
  return useSyncExternalStore(subscribe, () => hidden).filter((item) => item.owner === owner).map((item) => item.localId);
}
