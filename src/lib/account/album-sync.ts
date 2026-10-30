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
import { scanPreviewPath } from "@/lib/files/photos";
import { removeUnreferencedPhotos } from "@/lib/files/unreferenced-photos";
import { isTransientError } from "@/lib/network-error";

import { api } from "../../../convex/_generated/api";
import { downloadCollectionPhoto, removePhotoFile, uploadCollectionPhoto } from "./photo-transfer";
import { reportTransferFailure } from "./photo-transfer-failures";
import type { SyncContext } from "./sync";

export async function syncArtworkAlbums(context: SyncContext, token: string, isCurrent: () => boolean) {
  while (isCurrent()) {
    const deleted = deletedAlbumPhotoFiles(context.owner);
    if (deleted.length === 0) break;
    for (const photo of deleted) {
      const paths = new Set([
        photo.path,
        photo.capture?.photoPath,
        photo.capture?.cropPath,
        photo.capture && scanPreviewPath(photo.capture.cropPath),
        photo.capture?.labelPhotoPath,
      ]);
      for (const path of paths) {
        if (!isCurrent()) return;
        if (path && !(await isPhotoFileReferenced(path))) {
          removePhotoFile(path);
        }
      }
      clearDeletedAlbumPhotoPath(photo.localId, context.owner, photo.capture);
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
  // Failed photos stay pending, so advance past them before reporting the sweep's failure.
  let failure: unknown;
  let afterLocalId: string | undefined;
  while (isCurrent()) {
    const photos = albumPhotoTransfers(context.owner, afterLocalId);
    if (photos.length === 0) {
      if (failure) throw failure;
      if (afterLocalId === undefined) return;
      // A recovered legacy download still needs an album upload before its backup is ready to publish.
      afterLocalId = undefined;
      continue;
    }
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
        if (isTransientError(error)) throw error;
        reportTransferFailure(error, "album", upload ? "upload" : "download");
        failure = error;
      }
    }
    afterLocalId = photos.at(-1)!.localId;
  }
}
