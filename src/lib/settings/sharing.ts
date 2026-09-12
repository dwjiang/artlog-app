import { getSetting, setSetting } from '@/db/repos/settings';

const KEY = 'sharing-default';
const listeners = new Set<() => void>();

export async function getSharingDefault(): Promise<boolean> {
  return await getSetting(KEY) !== 'false';
}

export async function setSharingDefault(value: boolean): Promise<void> {
  await setSetting(KEY, String(value));
  for (const listener of listeners) listener();
}

export function subscribeSharingDefault(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
