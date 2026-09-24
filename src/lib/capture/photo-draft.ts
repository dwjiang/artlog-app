import { reportError } from "@/lib/observability";
import { db } from "../../db/client";
import { settings } from "../../db/schema";
import { eq } from "drizzle-orm";
import type { PhotoKind } from "../../../shared/collection/album";
import type { Id } from "../../../convex/_generated/dataModel";
import { findArtworkPhoto } from "../../db/repos/artwork-album";
import type { SaveResultInput } from "../result/save";

export type DraftPhoto = {
  localId: string;
  path: string;
  kind: PhotoKind;
  capturedAt: number;
  caption?: string;
  review?: "checking" | "conflict" | "uncertain";
  recognized?: {
    title: string;
    artist: string;
    objectId: import("../../../convex/_generated/dataModel").Id<"objects">;
    artworkId: import("../../../convex/_generated/dataModel").Id<"artworks">;
  };
};
/** Where one capture saves: no visit, an existing visit, or the visit at a museum that starts or resumes with the save. */
export type CaptureVisitChoice =
  | { kind: "none" }
  | { kind: "visit"; localId: string }
  | { kind: "venue"; venueId: Id<"museums"> };
export type PhotoSessionDraft = {
  photos: DraftPhoto[];
  primaryKind?: PhotoKind;
  visit?: CaptureVisitChoice;
  saveInput?: SaveResultInput;
};
function key(owner: string, draftId: string) {
  return `photoDraft:${owner}:${draftId}`;
}
export function readPhotoSession(owner: string, draftId: string): PhotoSessionDraft {
  const value = db
    .select()
    .from(settings)
    .where(eq(settings.key, key(owner, draftId)))
    .get()?.value;
  if (!value) return { photos: [] };
  try {
    const parsed = JSON.parse(value) as PhotoSessionDraft;
    return {
      ...parsed,
      photos: Array.isArray(parsed.photos)
        ? parsed.photos.filter(
            (photo) =>
              typeof photo?.localId === "string"
              && typeof photo?.path === "string"
              && ["full", "detail", "label"].includes(photo?.kind)
              && Number.isFinite(photo?.capturedAt),
          )
        : [],
    };
  } catch (error) {
    reportError(error, "capture.restore_photo_draft");
    return { photos: [] };
  }
}
export function readPhotoDraft(owner: string, draftId: string): DraftPhoto[] {
  return readPhotoSession(owner, draftId).photos;
}
export function updatePhotoSession(owner: string, draftId: string, patch: Partial<PhotoSessionDraft>) {
  const value = JSON.stringify({
    ...readPhotoSession(owner, draftId),
    ...patch,
  });
  db.insert(settings)
    .values({ key: key(owner, draftId), value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}
export function writePhotoDraft(owner: string, draftId: string, photos: DraftPhoto[]) {
  updatePhotoSession(owner, draftId, { photos });
}
export function clearPhotoDraft(owner: string, draftId: string) {
  db.delete(settings)
    .where(eq(settings.key, key(owner, draftId)))
    .run();
}

export function isLabelCapture(capture: { localId: string; owner: string; photoPath: string }) {
  return (
    readPhotoSession(capture.owner, capture.photoPath).primaryKind === "label"
    || findArtworkPhoto(capture.localId, capture.owner)?.kind === "label"
  );
}
