import { useAuthToken } from '@convex-dev/auth/react';
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
import { syncCollectionPhotos } from './photo-sync';
import { downloadCollectionPhoto, removePhotoFile, uploadCollectionPhoto } from './photo-transfer';

let context: SyncContext | null = null;
let generation = 0;
let paused = false;
let authToken: string | null = null;

type Queue = {
  label: string;
  run: (context: SyncContext, token: string, isCurrent: () => boolean) => Promise<void>;
  running: Promise<void> | null; requested: boolean; timer?: ReturnType<typeof setTimeout>;
};

function schedule(queue: Queue, delay: number): void {
  queue.requested = true;
  clearTimeout(queue.timer);
  queue.timer = setTimeout(() => { queue.timer = undefined; void flush(queue); }, delay);
}

async function flush(queue: Queue): Promise<void> {
  if (queue.running || paused || !context || !authToken || AppState.currentState !== 'active') return;
  const current = generation;
  const isCurrent = () => generation === current && !paused;
  queue.requested = false;
  queue.running = queue.run(context, authToken, isCurrent).catch((error: unknown) => {
    console.warn(`${queue.label} will retry`, error);
    schedule(queue, 30_000);
  }).finally(() => {
    queue.running = null;
    if (queue.requested && !queue.timer) schedule(queue, 500);
  });
  await queue.running;
}

// Photo transfers run in their own queue so a large backlog never delays note, deletion or import sync.
const transfers: Queue = {
  label: 'Photo transfer', running: null, requested: false,
  run: (_context, token, isCurrent) => syncCollectionPhotos({
    ...savedWorks,
    upload: (localId, kind, path) => uploadCollectionPhoto(token, localId, kind, path, isCurrent),
    download: (localId, kind, storageId) => downloadCollectionPhoto(token, localId, kind, storageId),
    removeFile: removePhotoFile,
  }, isCurrent),
};
const sync: Queue = {
  label: 'Collection sync', running: null, requested: false,
  run: async (context, _token, isCurrent) => {
    await syncCollection({
      ...savedWorks,
      getCheckpoint: () => getSetting('collectionSync'),
      setCheckpoint: (value) => setSetting('collectionSync', value),
      sync: (args) => convex.mutation(api.sync.syncCollection, args),
    }, context, isCurrent);
    if (isCurrent()) schedule(transfers, 0);
  },
};

function scheduleSync(delay = 500): void {
  schedule(sync, delay);
}

function stop(): void {
  generation++;
  for (const queue of [sync, transfers]) { clearTimeout(queue.timer); queue.timer = undefined; }
}

export function pauseCollectionSync(): void {
  paused = true;
  stop();
}

export function resumeCollectionSync(): void {
  paused = false;
  scheduleSync();
}

export function CollectionSync(): null {
  const token = useAuthToken();
  const ready = useDeviceReady();
  const device = useQuery(api.devices.me, ready ? {} : 'skip');
  const account = useQuery(api.accounts.me, ready ? {} : 'skip');
  const deviceId = device?.deviceId;
  const scope = account?.scope;
  const accountId = account?.accountId;
  useEffect(() => {
    generation++;
    authToken = token;
    context = deviceId && scope && accountId !== undefined && token ? { deviceId, scope, accountId } : null;
    if (context) scheduleSync();
    return () => { stop(); context = null; authToken = null; };
  }, [deviceId, scope, accountId, token]);
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
