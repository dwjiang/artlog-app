import type { SavedWork } from "@/db/schema";
import { upsertFromRemote } from "@/db/repos/saved-works";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { SavedRecognitionResult } from "../../../convex/savedRecognition";
import { captureOwner } from "@/lib/account/owner-store";
import { flushJournal } from "@/lib/account/collection-sync";
import { syncSavedRecognition } from "@/lib/account/recognition-sync";
import { convex } from "@/lib/convex-client";
import { removeUnreferencedPhotos } from "@/lib/files/unreferenced-photos";
import { convexErrorCode, isTransientError, SyncUnavailableError } from "@/lib/network-error";
import { requestCollectionSync } from "@/lib/account/sync-events";

export async function identifySavedArtwork(
  work: Pick<SavedWork, "owner" | "localId">,
): Promise<SavedRecognitionResult | null> {
  const session = captureOwner();
  if (session.owner !== work.owner || !session.scope) throw new SyncUnavailableError();
  await flushJournal();
  if (!session.isCurrent()) return null;
  await syncSavedRecognition({ owner: session.owner, scope: session.scope }, session.isCurrent, work.localId);
  if (!session.isCurrent()) return null;
  const result = await convex.action(api.savedRecognition.identify, { scope: session.scope, localId: work.localId });
  return session.isCurrent() ? result : null;
}

export async function acceptSavedRecognition(
  work: Pick<SavedWork, "owner" | "localId">,
  attempt: number,
  objectId: Id<"objects">,
): Promise<boolean> {
  const session = captureOwner();
  if (session.owner !== work.owner || !session.scope) throw new SyncUnavailableError();
  await flushJournal();
  if (!session.isCurrent()) return false;
  const updated = await convex.mutation(api.savedRecognition.accept, {
    scope: session.scope,
    localId: work.localId,
    attempt,
    objectId,
  });
  if (!session.isCurrent()) return false;
  await removeUnreferencedPhotos(await upsertFromRemote([updated], session.owner));
  requestCollectionSync();
  return session.isCurrent();
}

export function savedRecognitionError(error: unknown): string {
  switch (convexErrorCode(error)) {
    case "recognition_unavailable":
      return "Recognition data isn’t available yet. Open the app on the phone where you scanned this artwork and let it sync.";
    case "recognition_model_retired":
      return "This scan uses an older recognition model. Scan the artwork again to identify it.";
    case "saved_artwork_changed":
      return "This artwork was edited. Try identifying again before choosing a match.";
    case "unknown_candidate":
    case "search_superseded":
      return "These matches are out of date. Try identifying again.";
    case "rate_limited":
      return "Too many attempts. Try again in a moment.";
    case "not_found":
      return "This saved artwork is no longer available.";
  }
  return isTransientError(error)
    ? "Connect to the internet and try identifying again."
    : "Couldn’t identify this artwork. Your saved artwork is unchanged. Try again.";
}
