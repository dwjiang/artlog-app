import { randomUUID } from "expo-crypto";

import { findCapturePhoto, saveArtworkSession, selectArtworkPhotos } from "@/db/repos/artwork-album";
import { getSavedWork, listSavedWorks, markSynced } from "@/db/repos/saved-works";
import { getVisit } from "@/db/repos/visits";
import type { PendingScan, Visit } from "@/db/schema";
import { flushJournal } from "@/lib/account/collection-sync";
import { captureOwner } from "@/lib/account/owner-store";
import { requestCollectionSync } from "@/lib/account/sync-events";
import type { CaptureCompletion, VisitOutcome } from "@/lib/capture/completion";
import { clearPhotoDraft, readPhotoDraft, readPhotoSession } from "@/lib/capture/photo-draft";
import { captureVisitChoice } from "@/lib/capture/visit-choice";
import { convex } from "@/lib/convex-client";
import { keepPhotos } from "@/lib/files/kept-photos";
import { scanDisplayPath } from "@/lib/files/photos";
import type { ContributeInput } from "@/lib/label/contribute";
import { shareSavedLabel, type ContributionAttempt } from "@/lib/label/share-saved-label";
import { reportError } from "@/lib/observability";
import { openVisitLocalId, visitForSave } from "@/lib/venue/use-venue";
import { venueNameById } from "@/lib/venue/venue-db";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { buildSnapshot, type SnapshotDraft } from "./snapshot";
import type { ResultViewState } from "./state";

export type SaveResultInput = {
  /** Absent while the scan is still queued on this phone; the server row then references no scan. */
  scanId?: Id<"scans">;
  capture: Pick<
    PendingScan,
    | "localId"
    | "photoPath"
    | "cropPath"
    | "cropCorners"
    | "venueId"
    | "visitId"
    | "visitLocalId"
    | "capturedAt"
    | "owner"
  >;
  /** Absent when the card names no work (queued or unsupported); the snapshot is then whatever the user typed. */
  view?: ResultViewState;
  draft: SnapshotDraft;
  contribution?: ContributeInput;
};

export type SaveResultOutcome = {
  localId: string;
  completion: CaptureCompletion;
  /** Failed uploads stay queued for collection sync; the local save remains usable. */
  synced: Promise<void>;
  contribution?: Promise<ContributionAttempt>;
};

const ACTIONABLE = new Set(["Review your added photos before saving.", "Choose an available visit before saving."]);
/** Failures the person can resolve keep their message; anything else is a retry prompt. */
export function saveErrorMessage(cause: unknown): string {
  return cause instanceof Error && ACTIONABLE.has(cause.message) ? cause.message : "Couldn’t save. Try again.";
}

type LinkedVisit = Pick<
  Visit,
  "localId" | "venueId" | "venueName" | "visitedOn" | "timeZone" | "startedAt" | "remoteVisitId"
>;

/** Saves locally first, then mirrors the row to the collection on the server. `withoutVisit` keeps a museum save out of its visit. */
export async function saveResult(
  { scanId, capture, view, draft, contribution }: SaveResultInput,
  { withoutVisit = false } = {},
): Promise<SaveResultOutcome> {
  const current = captureOwner();
  if (capture.owner !== current.owner) throw new Error("Journal owner changed");
  const { snapshot, suggested } = buildSnapshot(draft, view);
  if (!snapshot.title) snapshot.title = "Unidentified artwork";
  if (readPhotoDraft(current.owner, capture.photoPath).some((photo) => photo.review)) {
    throw new Error("Review your added photos before saving.");
  }
  const session = readPhotoSession(current.owner, capture.photoPath);
  const choice = captureVisitChoice(capture, session);
  const openBefore = openVisitLocalId();
  let visit: LinkedVisit | undefined;
  let outcome: VisitOutcome | undefined;
  if (choice.kind === "visit") {
    const linked = await getVisit(choice.localId, current.owner, { discarded: !session.visit });
    if (!linked) {
      throw new Error(
        session.visit ? "Choose an available visit before saving." : "The capture is linked to an invalid visit",
      );
    }
    // A capture whose visit was discarded before it was saved keeps its museum and joins no visit.
    if (linked.deletedAt === null) {
      visit = linked;
      outcome = openBefore === visit.localId ? "joined" : "past";
    }
  } else if (choice.kind === "venue" && !withoutVisit) {
    // The first save at a museum starts its visit, dated by the shutter; later saves join it.
    const started = await visitForSave(choice.venueId, capture.capturedAt);
    visit = { ...started, remoteVisitId: started.remoteVisitId ?? null };
    outcome = openVisitLocalId() !== started.localId ? "past" : openBefore === started.localId ? "joined" : "started";
  }
  if (!current.isCurrent()) throw new Error("Journal owner changed");
  if (
    !session.visit
    && capture.visitLocalId != null
    && visit
    && capture.visitId != null
    && visit.remoteVisitId !== capture.visitId
  ) {
    throw new Error("The capture is linked to an invalid visit");
  }
  // A save with no visit (by default after "End visit" there today, or kept out of a visit open elsewhere) keeps its
  // museum; only a draft's "No visit" drops it.
  const venueId =
    visit?.venueId
    ?? (choice.kind === "venue" ? choice.venueId : session.visit ? undefined : (capture.venueId ?? undefined));
  const venueName =
    visit?.venueName
    ?? (venueId
      ? await venueNameById(venueId).catch((error: unknown) => {
          reportError(error, "result.resolve_venue", { level: "warning" });
          return undefined;
        })
      : undefined);
  // The scan was identified at the capture's museum, in its visit when one was open; the server confirms it only under that context.
  const contextChanged =
    venueId !== (capture.venueId ?? undefined)
    || (capture.visitLocalId != null && visit?.localId !== capture.visitLocalId);
  const confirmationScanId = contextChanged ? undefined : scanId;
  capture = {
    ...capture,
    visitLocalId: visit?.localId ?? null,
    visitId: visit?.remoteVisitId ?? null,
    venueId: venueId ?? null,
  };
  const primary = view?.primary;
  // The capture's album link keeps repeated saves on the same artwork.
  const captured = findCapturePhoto(capture.localId, current.owner);
  const saved = captured?.deletedAt === null ? await getSavedWork(captured.savedLocalId, current.owner) : undefined;
  const existing =
    saved?.deletedAt === null
      ? saved
      : view?.kind === "confident" && primary?.objectId
        ? (await listSavedWorks(current.owner)).find(
            (work) =>
              work.objectId === primary.objectId && work.title === snapshot.title && work.artist === snapshot.artist,
          )
        : undefined;
  const localId = existing?.localId ?? randomUUID();
  const savedAt = capture.capturedAt;
  if (!current.isCurrent()) throw new Error("Journal owner changed");
  const photos = selectArtworkPhotos(localId, current.owner).all();
  const additional = readPhotoDraft(current.owner, capture.photoPath).map((photo) => ({
    ...photo,
    savedLocalId: localId,
    visitLocalId: visit?.localId,
  }));
  if (!photos.some((photo) => photo.path === capture.photoPath)) {
    additional.unshift({
      localId: captured ? randomUUID() : capture.localId,
      savedLocalId: localId,
      path: capture.photoPath,
      kind: session.primaryKind ?? captured?.kind ?? "full",
      capturedAt: capture.capturedAt,
      visitLocalId: visit?.localId,
    });
  }
  saveArtworkSession(
    localId,
    existing
      ? undefined
      : {
          localId,
          savedAt,
          ...snapshot,
          visitLocalId: visit?.localId,
          venueId,
          venueName,
          gallery: primary?.gallery,
          objectId: primary?.objectId,
          artworkId: primary?.artworkId,
          scanId,
          photoPath: capture.photoPath,
          cropPath: scanDisplayPath(capture.cropPath),
          cropCorners: capture.cropCorners,
        },
    additional,
    visit?.localId,
    current.owner,
  );
  clearPhotoDraft(current.owner, capture.photoPath);
  void keepPhotos(additional);
  const synced = (async () => {
    if (!current.scope || !current.isCurrent()) return;
    // A failed flush only matters while the visit is still local; saveToCollection reports that itself.
    await flushJournal().catch(() => {});
    if (!current.isCurrent()) return;
    if (existing) return;
    const acknowledgement = await convex.mutation(api.collections.saveToCollection, {
      localId,
      scanId: confirmationScanId,
      objectId: primary?.objectId,
      artworkId: primary?.artworkId,
      venueId,
      visitLocalId: visit?.localId,
      scope: current.scope,
      gallery: primary?.gallery,
      snapshot,
      suggested: contextChanged ? null : suggested,
      savedAt,
      venueName,
    });
    if (current.isCurrent()) {
      await markSynced([{ ...acknowledgement, localId, revision: 0 }], current.owner);
    }
  })()
    .catch((error: unknown) => {
      reportError(error, "result.sync");
      console.warn("Could not sync the saved work; it stays on the phone", error);
    })
    .finally(requestCollectionSync);
  return {
    localId,
    synced,
    contribution: contribution && !contextChanged ? shareSavedLabel(contribution, localId) : undefined,
    completion: {
      savedId: localId,
      capture: {
        capturedAt: capture.capturedAt,
        venueId,
        photoIds: [
          ...photos.filter((photo) => photo.path === capture.photoPath).map((photo) => photo.localId),
          ...additional.map((photo) => photo.localId),
        ],
      },
      previewPath: scanDisplayPath(capture.cropPath),
      visitOutcome: visit && outcome,
    },
  };
}
