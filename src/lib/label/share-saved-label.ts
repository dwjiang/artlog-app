import { reportError } from "@/lib/observability";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";
import { AppState } from "react-native";

import { captureOwner } from "@/lib/account/owner-store";
import { findArtworkPhoto } from "@/db/repos/artwork-album";
import { getPendingScan } from "@/db/repos/pending-scans";
import { getSavedWork } from "@/db/repos/saved-works";
import { listSettings, removeSetting, setSetting } from "@/db/repos/settings";
import { isTransientError } from "@/lib/network-error";
import {
  contributeLabel,
  contributionErrorMessage,
  type ContributionOutcome,
  type ContributeInput,
} from "./contribute";

export type ContributionAttempt =
  | { result: ContributionOutcome; error?: never }
  | { error: string; result?: never };

// The capture bytes stay in pendingScans; a queued share keeps only what the flusher needs to rebuild the input.
type PendingShare = {
  scanId: ContributeInput["scanId"];
  captureLocalId: string;
  savedLocalId: string;
  state: ContributeInput["state"];
  museumSearchUpdatedAt?: number;
};
const key = (owner: string, scanId: string) =>
  `pendingShare:${owner}:${scanId}`;
const inFlight = new Map<string, Promise<ContributionAttempt>>();

/** Shares a saved work; a transport failure leaves the share queued for the next flush, other failures wait for the person. */
export function shareSavedLabel(
  input: ContributeInput,
  savedLocalId: string,
): Promise<ContributionAttempt> {
  const id = key(input.capture.owner, input.scanId);
  const running = inFlight.get(id);
  if (running) return running;
  const attempt = (async (): Promise<ContributionAttempt> => {
    const queued: PendingShare = {
      scanId: input.scanId,
      captureLocalId: input.capture.localId,
      savedLocalId,
      state: input.state,
      museumSearchUpdatedAt: input.museumSearchUpdatedAt,
    };
    await setSetting(id, JSON.stringify(queued));
    try {
      const result = await contributeLabel(input);
      await removeSetting(id);
      return { result };
    } catch (error) {
      reportError(error, "label.share");
      if (!isTransientError(error)) await removeSetting(id);
      return { error: contributionErrorMessage(error) };
    }
  })().finally(() => inFlight.delete(id));
  inFlight.set(id, attempt);
  return attempt;
}

let flushing: Promise<void> | undefined;
/** Retries queued shares one run at a time; a share whose capture left the phone or whose artwork was deleted is dropped. */
export function flushPendingShares(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const current = captureOwner();
    if (
      !current.scope
      || (await getNetworkStateAsync()).isInternetReachable === false
    ) {
      return;
    }
    for (const { key: id, value } of await listSettings(
      key(current.owner, ""),
    )) {
      if (!current.isCurrent()) return;
      const share = JSON.parse(value) as PendingShare;
      const capture = await getPendingScan(share.captureLocalId, current.owner);
      if (!capture || !(await isSaved(share, capture.localId, current.owner))) {
        await removeSetting(id);
        continue;
      }
      await shareSavedLabel(
        {
          scanId: share.scanId,
          capture,
          state: share.state,
          museumSearchUpdatedAt: share.museumSearchUpdatedAt,
        },
        share.savedLocalId,
      );
    }
  })()
    .catch((error: unknown) => {
      reportError(error, "label.flush_shares");
      console.warn("Could not flush queued shares", error);
    })
    .finally(() => {
      flushing = undefined;
    });
  return flushing;
}

// The capture's album row follows the photo into whichever artwork it is merged; a delete and re-save tombstones that
// row and creates another, so the share also stands while the artwork it was queued for is still in the collection.
async function isSaved(
  share: PendingShare,
  captureLocalId: string,
  owner: string,
): Promise<boolean> {
  const photo = findArtworkPhoto(captureLocalId, owner);
  for (const localId of new Set([photo?.savedLocalId, share.savedLocalId])) {
    if (localId && (await getSavedWork(localId, owner))?.deletedAt === null) {
      return true;
    }
  }
  return false;
}

/** Flushes now, on reconnect and on foreground. */
export function startPendingShareFlusher(): () => void {
  void flushPendingShares();
  const network = addNetworkStateListener((state) => {
    if (state.isInternetReachable ?? state.isConnected) {
      void flushPendingShares();
    }
  });
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active") void flushPendingShares();
  });
  return () => {
    network.remove();
    appState.remove();
  };
}
