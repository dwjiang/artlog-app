import { findArtworkPhoto } from "@/db/repos/artwork-album";
import { deletePendingScan, getPendingScan } from "@/db/repos/pending-scans";
import { removePhotoFile } from "@/lib/account/photo-transfer";
import { scanPreviewPath } from "@/lib/files/photos";

import { clearPhotoDraft, readPhotoDraft } from "./photo-draft";

export async function discardCapture(localId: string, owner: string): Promise<void> {
  const capture = await getPendingScan(localId, owner);
  if (!capture) return;
  if (findArtworkPhoto(localId, owner)) {
    throw new Error("This scan has already been saved.");
  }
  const paths = new Set([
    capture.photoPath,
    capture.cropPath,
    scanPreviewPath(capture.cropPath),
    capture.labelPhotoPath,
    ...readPhotoDraft(owner, capture.photoPath).map((photo) => photo.path),
  ]);
  // Leave the row and draft available for another cleanup attempt if a file cannot be removed.
  for (const path of paths) if (path) removePhotoFile(path);
  await deletePendingScan(localId, owner);
  clearPhotoDraft(owner, capture.photoPath);
}
