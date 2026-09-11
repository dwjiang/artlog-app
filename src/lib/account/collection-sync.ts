import { useQuery } from 'convex/react';
import { addNetworkStateListener } from 'expo-network';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { api } from '../../../convex/_generated/api';
import * as savedWorks from '@/db/repos/saved-works';
import { getSetting, setSetting } from '@/db/repos/settings';
import { convex } from '@/lib/convex-client';
import { useDeviceReady } from '@/lib/use-device-ready';
import { syncCollection, type SyncContext } from './sync';
import { onCollectionChange } from './sync-events';

let context: SyncContext | null = null;
let generation = 0;
let paused = false;
let running: Promise<void> | null = null;
let requested = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function scheduleSync(delay = 500): void {
  requested = true;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = undefined; void flush(); }, delay);
}

async function flush(): Promise<void> {
  if (running || paused || !context || AppState.currentState !== 'active') return;
  const current = generation;
  requested = false;
  running = syncCollection({
    ...savedWorks,
    getCheckpoint: () => getSetting('collectionSync'),
    setCheckpoint: (value) => setSetting('collectionSync', value),
    sync: (args) => convex.mutation(api.sync.syncCollection, args),
  }, context, () => generation === current && !paused).catch((error: unknown) => {
    console.warn('Collection sync will retry', error);
    scheduleSync(30_000);
  }).finally(() => {
    running = null;
    if (requested && !timer) scheduleSync();
  });
  await running;
}

export function pauseCollectionSync(): void {
  paused = true;
  generation++;
  clearTimeout(timer);
  timer = undefined;
}

export function resumeCollectionSync(): void {
  paused = false;
  scheduleSync();
}

export function CollectionSync(): null {
  const ready = useDeviceReady();
  const device = useQuery(api.devices.me, ready ? {} : 'skip');
  const account = useQuery(api.accounts.me, ready ? {} : 'skip');
  const deviceId = device?.deviceId;
  const scope = account?.scope;
  const accountId = account?.accountId;
  useEffect(() => {
    generation++;
    context = deviceId && scope && accountId ? { deviceId, scope, accountId } : null;
    if (context) scheduleSync();
    return () => { generation++; context = null; clearTimeout(timer); timer = undefined; };
  }, [deviceId, scope, accountId]);
  useEffect(() => {
    const unsubscribe = onCollectionChange(() => scheduleSync());
    const foreground = AppState.addEventListener('change', (state) => { if (state === 'active') scheduleSync(); });
    const network = addNetworkStateListener((state) => {
      if (state.isInternetReachable ?? state.isConnected) scheduleSync();
    });
    return () => { unsubscribe(); foreground.remove(); network.remove(); };
  }, []);
  return null;
}
