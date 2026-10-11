import {
  acknowledgeAlbum,
  albumPhotoTransfers,
  applyAlbum,
  clearDeletedAlbumPhotoPath,
  deletedAlbumPhotoFiles,
  encounterInput,
  pendingAlbum,
  photoInput,
  updateAlbumTransfer,
} from "@/db/repos/artwork-album";
import { hasLegacyAlbumRecovery, recoverLegacyAlbumPhotos } from "@/db/repos/legacy-album-recovery";
import { getSavedWork, isPhotoFileReferenced, upsertFromRemote } from "@/db/repos/saved-works";
import { getSetting, setSetting } from "@/db/repos/settings";
import { upsertVisitsFromRemote } from "@/db/repos/visits";
import { convex } from "@/lib/convex-client";
import { photoFileExists } from "@/lib/files/photo-transfer-needed";
import { removeUnreferencedPhotos } from "@/lib/files/unreferenced-photos";
import { reportError } from "@/lib/observability";

import { api } from "../../../convex/_generated/api";
import { downloadCollectionPhoto, removePhotoFile, uploadCollectionPhoto } from "./photo-transfer";
import type { SyncContext } from "./sync";

export async function syncArtworkAlbums(context: SyncContext, token: string, isCurrent: () => boolean) {
  while (isCurrent()) {
    const deleted = deletedAlbumPhotoFiles(context.owner);
    if (deleted.length === 0) break;
    for (const photo of deleted) {
      if (!isCurrent()) return;
      if (!(await isPhotoFileReferenced(photo.path))) {
        removePhotoFile(photo.path);
      }
      clearDeletedAlbumPhotoPath(photo.localId, context.owner);
    }
  }
  const key = `albumSync:${context.owner}`;
  let since = Number((await getSetting(key)) ?? 0);
  let recovering = hasLegacyAlbumRecovery(context.owner);
  while (isCurrent()) {
    const pending = recovering ? { photos: [], encounters: [] } : pendingAlbum(context.owner);
    const result = await convex.mutation(api.artworkAlbums.sync, {
      scope: context.scope,
      since,
      photos: pending.photos.map(photoInput),
      encounters: pending.encounters.map(encounterInput),
    });
    if (!isCurrent()) return;
    await upsertVisitsFromRemote(result.visits, context.owner);
    if (!isCurrent()) return;
    await removeUnreferencedPhotos(await upsertFromRemote(result.saves, context.owner));
    if (!isCurrent()) return;
    acknowledgeAlbum(pending, context.owner);
    applyAlbum(result.photos, result.encounters, context.owner);
    since = result.checkpoint;
    await setSetting(key, String(since));
    if (!isCurrent()) return;
    if (recovering && !result.hasMore) {
      recoverLegacyAlbumPhotos(context.owner);
      recovering = false;
    }
    if (
      !result.hasMore
      && pendingAlbum(context.owner).photos.length === 0
      && pendingAlbum(context.owner).encounters.length === 0
    ) {
      break;
    }
  }
  // One photo that keeps failing must not stop the others: finish the batch, then rethrow so the queue retries.
  while (isCurrent()) {
    const photos = albumPhotoTransfers(context.owner);
    if (photos.length === 0) return;
    let failure: unknown;
    for (const photo of photos) {
      if (!isCurrent()) return;
      const upload = photo.path && !photo.storageId && (!photo.recoveryStorageId || photoFileExists(photo.path));
      try {
        if (upload) {
          const { storageId } = await uploadCollectionPhoto(
            token,
            context.scope,
            photo.savedLocalId,
            "photo",
            photo.path!,
            isCurrent,
            photo.localId,
          );
          if (isCurrent()) {
            updateAlbumTransfer(photo.localId, { storageId }, context.owner);
          }
        } else if (photo.storageId || photo.recoveryStorageId) {
          const storageId = photo.storageId ?? photo.recoveryStorageId!;
          const work = !photo.storageId ? await getSavedWork(photo.savedLocalId, context.owner) : undefined;
          if (!isCurrent()) return;
          if (!photo.storageId && work?.cropStorageId !== storageId) continue;
          // A legacy album may have been recovered from the save's crop. Read it through that owned source.
          const kind = photo.storageId ? "photo" : "crop";
          const path = await downloadCollectionPhoto(
            token,
            context.scope,
            photo.savedLocalId,
            kind,
            storageId,
            kind === "photo" ? photo.localId : undefined,
          );
          if (!isCurrent() || !updateAlbumTransfer(photo.localId, { path }, context.owner)) {
            removePhotoFile(path);
          }
        }
      } catch (error) {
        reportError(error, "sync.photos", {
          data: {
            kind: "album",
            direction: upload ? "upload" : "download",
          },
        });
        failure = error;
      }
    }
    if (failure) throw failure;
  }
}
