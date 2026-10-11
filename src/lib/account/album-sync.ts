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
import { isPhotoFileReferenced, upsertFromRemote } from "@/db/repos/saved-works";
import { getSetting, setSetting } from "@/db/repos/settings";
import { upsertVisitsFromRemote } from "@/db/repos/visits";
import { convex } from "@/lib/convex-client";
import { scanPreviewPath } from "@/lib/files/photos";
import { removeUnreferencedPhotos } from "@/lib/files/unreferenced-photos";
import { isTransientError } from "@/lib/network-error";
import { reportError } from "@/lib/observability";

import { api } from "../../../convex/_generated/api";
import { downloadCollectionPhoto, removePhotoFile, uploadCollectionPhoto } from "./photo-transfer";
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
  while (isCurrent()) {
    const pending = pendingAlbum(context.owner);
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
      return;
    }
    for (const photo of photos) {
      if (!isCurrent()) return;
      try {
        if (photo.path && !photo.storageId) {
          const { storageId } = await uploadCollectionPhoto(
            token,
            context.scope,
            photo.savedLocalId,
            "photo",
            photo.path,
            isCurrent,
            photo.localId,
          );
          if (isCurrent()) {
            updateAlbumTransfer(photo.localId, { storageId }, context.owner);
          }
        } else if (!photo.path && photo.storageId) {
          const path = await downloadCollectionPhoto(
            token,
            context.scope,
            photo.savedLocalId,
            "photo",
            photo.storageId,
            photo.localId,
          );
          if (!isCurrent() || !updateAlbumTransfer(photo.localId, { path }, context.owner)) {
            removePhotoFile(path);
          }
        }
      } catch (error) {
        if (isTransientError(error)) throw error;
        reportError(error, "sync.photos", {
          data: {
            kind: "album",
            direction: photo.path ? "upload" : "download",
          },
        });
        failure = error;
      }
    }
    afterLocalId = photos.at(-1)!.localId;
  }
}
