import { useAuthToken } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { addNetworkStateListener } from "expo-network";
import { useEffect } from "react";
import { AppState } from "react-native";

import { api } from "../../../convex/_generated/api";
import { createJournalRepository } from "@/db/repos/journal";
import { claimLocalJournal } from "@/db/repos/journal-claim";
import { listUnsyncedVisits } from "@/db/repos/visits";
import { anonymousOwner, captureOwner, getLocalOwner, switchOwner } from "./owner-store";
import * as savedWorks from "@/db/repos/saved-works";
import { albumMediaPending } from "@/db/repos/artwork-album";
import { getSetting, setSetting } from "@/db/repos/settings";
import { convex } from "@/lib/convex-client";
import { SyncUnavailableError } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { useDeviceReady } from "@/lib/use-device-ready";
import { syncJournal, type SyncContext } from "./sync";
import { onCollectionChange } from "./sync-events";
import { syncCollectionPhotos } from "./photo-sync";
import { downloadCollectionPhoto, removePhotoFile, uploadCollectionPhoto } from "./photo-transfer";
import { syncArtworkAlbums } from "./album-sync";
import { removeUnreferencedPhotos } from "../files/unreferenced-photos";

let context: SyncContext | null = null;
let generation = 0;
let paused = false;
let authToken: string | null = null;

type Queue = {
  label: string;
  operation: "sync.photos" | "sync.journal";
  run: (context: SyncContext, token: string, isCurrent: () => boolean) => Promise<void>;
  running: Promise<void> | null;
  requested: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

function schedule(queue: Queue, delay: number): void {
  queue.requested = true;
  clearTimeout(queue.timer);
  queue.timer = setTimeout(() => {
    queue.timer = undefined;
    void flush(queue);
  }, delay);
}

function ready(): { context: SyncContext; token: string } | null {
  return !paused && context && authToken && AppState.currentState === "active"
    ? { context, token: authToken }
    : null;
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
    .catch((error: unknown) => {
      failure = error;
      console.warn(`${queue.label} will retry`, error);
      reportError(error, queue.operation);
      schedule(queue, 30_000);
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
  run: async (context, token, isCurrent) => {
    await syncArtworkAlbums(context, token, isCurrent);
    await syncCollectionPhotos(
      {
        ...savedWorks,
        listPhotoTransfers: () => savedWorks.listPhotoTransfers(context.owner),
        getSavedWork: (id) => savedWorks.getSavedWork(id, context.owner),
        updatePhotoTransfer: (id, fields, _owner, expected) =>
          savedWorks.updatePhotoTransfer(id, fields, context.owner, expected),
        listDeletedPhotoFiles: () => savedWorks.listDeletedPhotoFiles(context.owner),
        clearDeletedPhotoPaths: (id) => savedWorks.clearDeletedPhotoPaths(id, context.owner),
        upload: (localId, kind, path) =>
          uploadCollectionPhoto(token, context.scope, localId, kind, path, isCurrent),
        download: (localId, kind, storageId) =>
          downloadCollectionPhoto(token, context.scope, localId, kind, storageId),
        removeFile: removePhotoFile,
      },
      isCurrent,
    );
  },
};
const sync: Queue = {
  label: "Collection sync",
  operation: "sync.journal",
  running: null,
  requested: false,
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
    if (isCurrent()) schedule(transfers, 0);
  },
};

export async function completeJournalClaim(
  account: Pick<SyncContext, "accountId" | "scope">,
  isCurrent = captureOwner().isCurrent,
): Promise<void> {
  if (!account.accountId) return;
  let claim;
  do {
    claim = await convex.mutation(api.journalClaims.resume, { scope: account.scope });
    if (!isCurrent()) return;
  } while (!claim.complete);
  const owner = `account:${account.accountId}`;
  if (claim.claimId) await claimLocalJournal(anonymousOwner(), owner, claim.claimId);
  if (!isCurrent()) return;
  switchOwner(owner, account.scope);
  await setSetting("activeJournalOwner", owner);
}

function scheduleSync(delay = 500): void {
  schedule(sync, delay);
}

function stop(): void {
  generation++;
  for (const queue of [sync, transfers]) {
    clearTimeout(queue.timer);
    queue.timer = undefined;
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
  return (
    (await savedWorks.listUnsynced(owner)).length > 0 ||
    (await listUnsyncedVisits(owner)).length > 0
  );
}

/**
 * Syncs the journal, album rows and photo bytes before an action publishes references to them. A transfer failure
 * fails the caller only while something it depends on is still missing; an unrelated stuck photo keeps retrying alone.
 * Each sync round trip spends a shared rate-limit token, so a caller with nothing pending makes no request at all.
 */
export async function flushCollectionMedia(
  dependsOn: Parameters<typeof albumMediaPending>[1] = {},
): Promise<void> {
  const session = ready();
  if (!session) throw new SyncUnavailableError();
  const { owner } = session.context;
  if (!albumMediaPending(owner, dependsOn) && !(await journalPending(owner))) return;
  await flushJournal();
  while (transfers.running) await transfers.running;
  if (!ready()) throw new SyncUnavailableError();
  const failure = await flush(transfers);
  if (failure !== undefined && albumMediaPending(owner, dependsOn)) throw failure;
}

export function resumeCollectionSync(): void {
  paused = false;
  if (context && !context.accountId && context.owner === getLocalOwner())
    switchOwner(context.owner, context.scope);
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
        if (current.owner !== context.owner || current.scope !== scope)
          switchOwner(getLocalOwner());
      } else {
        switchOwner(context.owner, paused ? undefined : scope);
        void setSetting("activeJournalOwner", context.owner).catch((error: unknown) =>
          reportError(error, "sync.persist_owner"),
        );
      }
      scheduleSync();
    } else switchOwner(getLocalOwner());
    return () => {
      stop();
      context = null;
      authToken = null;
    };
  }, [deviceId, scope, accountId, token]);
  useEffect(() => {
    const unsubscribe = onCollectionChange(() => scheduleSync());
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") scheduleSync();
    });
    const network = addNetworkStateListener((state) => {
      if (state.isInternetReachable ?? state.isConnected) scheduleSync();
    });
    return () => {
      unsubscribe();
      foreground.remove();
      network.remove();
    };
  }, []);
  return null;
}
