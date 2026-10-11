import { useAuthToken } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { addNetworkStateListener } from "expo-network";
import { useEffect } from "react";
import { AppState } from "react-native";

import { albumMediaPending, selectArtworkPhotos } from "@/db/repos/artwork-album";
import { createJournalRepository } from "@/db/repos/journal";
import { claimLocalJournal } from "@/db/repos/journal-claim";
import * as savedWorks from "@/db/repos/saved-works";
import { getSetting, setSetting } from "@/db/repos/settings";
import { listUnsyncedVisits } from "@/db/repos/visits";
import { convex } from "@/lib/convex-client";
import { removeUnreferencedPhotos } from "@/lib/files/unreferenced-photos";
import { SyncUnavailableError } from "@/lib/network-error";
import { hasInternetSignal } from "@/lib/network-state";
import { reportError } from "@/lib/observability";
import { useDeviceReady } from "@/lib/use-device-ready";

import { api } from "../../../convex/_generated/api";
import { syncArtworkAlbums } from "./album-sync";
import { anonymousOwner, captureOwner, getLocalOwner, switchOwner } from "./owner-store";
import { syncCollectionPhotos } from "./photo-sync";
import { downloadCollectionPhoto, removePhotoFile, uploadCollectionPhoto } from "./photo-transfer";
import { syncSavedRecognition } from "./recognition-sync";
import { syncJournal, type SyncContext } from "./sync";
import { onCollectionChange } from "./sync-events";

let context: SyncContext | null = null;
let generation = 0;
let paused = false;
let authToken: string | null = null;

type Queue = {
  label: string;
  operation: "sync.photos" | "sync.journal" | "sync.recognition";
  run: (context: SyncContext, token: string, isCurrent: () => boolean) => Promise<void>;
  running: Promise<void> | null;
  requested: boolean;
  timer?: ReturnType<typeof setTimeout>;
  failures: number;
  retryAt: number;
};

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;

function schedule(queue: Queue, delay: number): void {
  queue.requested = true;
  clearTimeout(queue.timer);
  // Local changes never shorten a failure backoff, so a persistent server error cannot retry on every save.
  queue.timer = setTimeout(
    () => {
      queue.timer = undefined;
      void flush(queue);
    },
    Math.max(delay, queue.retryAt - Date.now()),
  );
}

function ready(): { context: SyncContext; token: string } | null {
  return !paused && context && authToken && AppState.currentState === "active" ? { context, token: authToken } : null;
}

/** Scheduled runs retry on their own; the resolved failure lets a direct caller rethrow it instead. */
async function flush(queue: Queue): Promise<unknown> {
  const session = ready();
  if (queue.running || !session) return;
  const current = generation;
  const isCurrent = () => generation === current && !paused;
  queue.requested = false;
  let failure: unknown;
  queue.running = queue
    .run(session.context, session.token, isCurrent)
    .then(() => {
      queue.failures = 0;
      queue.retryAt = 0;
    })
    .catch((error: unknown) => {
      failure = error;
      console.warn(`${queue.label} will retry`, error);
      reportError(error, queue.operation);
      queue.failures++;
      queue.retryAt = Date.now() + Math.min(RETRY_BASE_MS * 2 ** (queue.failures - 1), RETRY_MAX_MS);
      schedule(queue, 0);
    })
    .finally(() => {
      queue.running = null;
      if (queue.requested && !queue.timer) schedule(queue, 500);
    });
  await queue.running;
  return failure;
}

// Photo transfers run in their own queue so a large backlog never delays note, deletion or import sync.
const transfers: Queue = {
  label: "Photo transfer",
  operation: "sync.photos",
  running: null,
  requested: false,
  failures: 0,
  retryAt: 0,
  run: async (context, token, isCurrent) => {
    let failure: unknown;
    await syncArtworkAlbums(context, token, isCurrent).catch((error: unknown) => {
      failure = error;
    });
    if (!isCurrent()) return;
    await syncCollectionPhotos(
      {
        ...savedWorks,
        listPhotoTransfers: () => savedWorks.listPhotoTransfers(context.owner),
        getSavedWork: (id) => savedWorks.getSavedWork(id, context.owner),
        updatePhotoTransfer: (id, fields, _owner, expected) =>
          savedWorks.updatePhotoTransfer(id, fields, context.owner, expected),
        listDeletedPhotoFiles: () => savedWorks.listDeletedPhotoFiles(context.owner),
        clearDeletedPhotoPaths: (id) => savedWorks.clearDeletedPhotoPaths(id, context.owner),
        upload: async (localId, kind, path) => {
          const work = await savedWorks.getSavedWork(localId, context.owner);
          const original =
            work?.cropPath === path && work.cropPhotoLocalId
              ? selectArtworkPhotos(localId, context.owner)
                  .all()
                  .find((photo) => photo.localId === work.cropPhotoLocalId)
              : undefined;
          return uploadCollectionPhoto(token, context.scope, localId, kind, path, isCurrent, original?.localId);
        },
        download: (localId, kind, storageId) => downloadCollectionPhoto(token, context.scope, localId, kind, storageId),
        removeFile: removePhotoFile,
      },
      isCurrent,
    ).catch((error: unknown) => {
      if (failure !== undefined) reportError(failure, "sync.photos");
      failure = error;
    });
    if (failure !== undefined) throw failure;
  },
};
// Saved-scan uploads get their own queue too: flushCollectionMedia waits on transfers, never on this backlog.
const recognition: Queue = {
  label: "Saved scan upload",
  operation: "sync.recognition",
  running: null,
  requested: false,
  failures: 0,
  retryAt: 0,
  run: (context, _token, isCurrent) => syncSavedRecognition(context, isCurrent),
};
const sync: Queue = {
  label: "Collection sync",
  operation: "sync.journal",
  running: null,
  requested: false,
  failures: 0,
  retryAt: 0,
  run: async (context, _token, isCurrent) => {
    if (context.accountId) await completeJournalClaim(context, isCurrent);
    if (!isCurrent()) return;
    await syncJournal(
      {
        ...savedWorks,
        ...createJournalRepository(context.owner, isCurrent),
        getCheckpoint: () => getSetting(`journalSync:${context.owner}`),
        setCheckpoint: (value) => setSetting(`journalSync:${context.owner}`, value),
        sync: (args) => convex.mutation(api.sync.syncJournal, args),
        removeUnreferencedPhotos,
      },
      context,
      isCurrent,
    );
    if (isCurrent()) {
      schedule(transfers, 0);
      schedule(recognition, 0);
    }
  },
};

export async function completeJournalClaim(
  account: Pick<SyncContext, "accountId" | "scope">,
  isCurrent = captureOwner().isCurrent,
): Promise<void> {
  if (!account.accountId) return;
  let claim;
  do {
    claim = await convex.mutation(api.journalClaims.resume, {
      scope: account.scope,
    });
    if (!isCurrent()) return;
  } while (!claim.complete);
  const owner = `account:${account.accountId}`;
  if (claim.claimId) {
    await claimLocalJournal(anonymousOwner(), owner, claim.claimId);
  }
  if (!isCurrent()) return;
  switchOwner(owner, account.scope);
  await setSetting("activeJournalOwner", owner);
}

const queues = [sync, transfers, recognition];

function scheduleSync(delay = 500): void {
  schedule(sync, delay);
}

// Foreground and reconnect are fresh chances to succeed; a repeated failure resumes the longer backoff.
function retrySync(): void {
  for (const queue of queues) queue.retryAt = 0;
  scheduleSync();
}

function stop(): void {
  generation++;
  for (const queue of queues) {
    clearTimeout(queue.timer);
    queue.timer = undefined;
    queue.failures = 0;
    queue.retryAt = 0;
  }
}

export function pauseCollectionSync(): void {
  paused = true;
  switchOwner(getLocalOwner());
  stop();
}

/** Runs one journal sync now and rejects the way the sync did, so callers keep the server's error classification. */
export async function flushJournal(): Promise<void> {
  while (sync.running) await sync.running;
  if (!ready()) throw new SyncUnavailableError();
  const failure = await flush(sync);
  if (failure !== undefined) throw failure;
}

async function journalPending(owner: string): Promise<boolean> {
  return (await savedWorks.listUnsynced(owner)).length > 0 || (await listUnsyncedVisits(owner)).length > 0;
}

/**
 * Syncs the journal, album rows and photo bytes before an action publishes references to them. A transfer failure
 * fails the caller only while something it depends on is still missing; an unrelated stuck photo keeps retrying alone.
 * Each sync round trip spends a shared rate-limit token, so a caller with nothing pending makes no request at all.
 */
export async function flushCollectionMedia(dependsOn: Parameters<typeof albumMediaPending>[1] = {}): Promise<void> {
  const session = ready();
  if (!session) throw new SyncUnavailableError();
  const { owner } = session.context;
  if (!albumMediaPending(owner, dependsOn) && !(await journalPending(owner))) {
    return;
  }
  await flushJournal();
  while (transfers.running) await transfers.running;
  if (!ready()) throw new SyncUnavailableError();
  const failure = await flush(transfers);
  if (albumMediaPending(owner, dependsOn)) {
    throw failure ?? new SyncUnavailableError();
  }
}

export function resumeCollectionSync(): void {
  paused = false;
  if (context && !context.accountId && context.owner === getLocalOwner()) {
    switchOwner(context.owner, context.scope);
  }
  scheduleSync();
}

export function CollectionSync(): null {
  const token = useAuthToken();
  const ready = useDeviceReady();
  const device = useQuery(api.devices.me, ready ? {} : "skip");
  const account = useQuery(api.accounts.me, ready ? {} : "skip");
  const deviceId = device?.deviceId;
  const scope = account?.scope;
  const accountId = account?.accountId;
  useEffect(() => {
    generation++;
    authToken = token;
    context =
      deviceId && scope && accountId !== undefined && token
        ? {
            deviceId,
            scope,
            accountId,
            owner: accountId ? `account:${accountId}` : anonymousOwner(),
          }
        : null;
    if (context) {
      if (context.accountId) {
        // The account scope is usable only once its claim finished; a token refresh alone leaves it valid.
        const current = captureOwner();
        if (current.owner !== context.owner || current.scope !== scope) {
          switchOwner(getLocalOwner());
        }
      } else {
        switchOwner(context.owner, paused ? undefined : scope);
        void setSetting("activeJournalOwner", context.owner).catch((error: unknown) =>
          reportError(error, "sync.persist_owner"),
        );
      }
      scheduleSync();
    } else {
      switchOwner(getLocalOwner());
    }
    return () => {
      stop();
      context = null;
      authToken = null;
    };
  }, [deviceId, scope, accountId, token]);
  useEffect(() => {
    const unsubscribe = onCollectionChange(() => scheduleSync());
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") retrySync();
    });
    const network = addNetworkStateListener((state) => {
      if (hasInternetSignal(state)) retrySync();
    });
    return () => {
      unsubscribe();
      foreground.remove();
      network.remove();
    };
  }, []);
  return null;
}
