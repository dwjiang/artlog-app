import { getPendingScan } from "@/db/repos/pending-scans";
import { pendingSavedRecognition, recognitionSyncKey } from "@/db/repos/saved-recognition";
import { getSavedWork } from "@/db/repos/saved-works";
import { setSetting } from "@/db/repos/settings";
import { convex } from "@/lib/convex-client";
import { convexErrorCode } from "@/lib/network-error";
import { reportError } from "@/lib/observability";

import { api } from "../../../convex/_generated/api";
import type { SyncContext } from "./sync";

export async function syncSavedRecognition(
  context: Pick<SyncContext, "owner" | "scope">,
  isCurrent: () => boolean,
  localId?: string,
): Promise<void> {
  while (isCurrent()) {
    const pending = pendingSavedRecognition(context.owner, localId);
    if (pending.length === 0) return;
    let failure: unknown;
    for (const entry of pending) {
      if (!isCurrent()) return;
      try {
        const work = await getSavedWork(entry.localId, context.owner);
        const capture = await getPendingScan(entry.sourceLocalId, context.owner);
        if (!isCurrent()) return;
        if (!capture || !work || work.deletedAt !== null) continue;
        await convex.action(api.savedRecognition.upload, {
          scope: context.scope,
          localId: entry.localId,
          sourceLocalId: capture.localId,
          vector: capture.vector,
          descriptors: capture.descriptors,
          keypoints: capture.keypoints,
          modelVersion: capture.modelVersion,
        });
        if (!isCurrent()) return;
        await setSetting(recognitionSyncKey(context.owner, entry.localId), capture.localId);
      } catch (error) {
        // The rest of the batch would spend requests on the same limit; the queue retries after its backoff.
        if (convexErrorCode(error) === "rate_limited") throw error;
        reportError(error, "sync.recognition");
        failure = error;
      }
    }
    if (failure) throw failure;
  }
}
