import {
  isPhotoFileReferenced,
  upsertFromRemote,
} from "../../db/repos/saved-works";
import { upsertVisitsFromRemote } from "../../db/repos/visits";
import { api } from "../../../convex/_generated/api";
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
} from "../../db/repos/artwork-album";
import { getSetting, setSetting } from "../../db/repos/settings";
import { convex } from "../convex-client";
import {
  downloadCollectionPhoto,
  removePhotoFile,
  uploadCollectionPhoto,
} from "./photo-transfer";
import { removeUnreferencedPhotos } from "../files/unreferenced-photos";
import type { SyncContext } from "./sync";
import { reportError } from "../observability";

export async function syncArtworkAlbums(
  context: SyncContext,
  token: string,
  isCurrent: () => boolean,
) {
  while (isCurrent()) {
    const deleted = deletedAlbumPhotoFiles(context.owner);
    if (!deleted.length) break;
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
    await removeUnreferencedPhotos(
      await upsertFromRemote(result.saves, context.owner),
    );
    if (!isCurrent()) return;
    acknowledgeAlbum(pending, context.owner);
    applyAlbum(result.photos, result.encounters, context.owner);
    since = result.checkpoint;
    await setSetting(key, String(since));
    if (
      !result.hasMore
      && !pendingAlbum(context.owner).photos.length
      && !pendingAlbum(context.owner).encounters.length
    ) {
      break;
    }
  }
  // One photo that keeps failing must not stop the others: finish the batch, then rethrow so the queue retries.
  while (isCurrent()) {
    const photos = albumPhotoTransfers(context.owner);
    if (!photos.length) return;
    let failure: unknown;
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
          if (
            !isCurrent()
            || !updateAlbumTransfer(photo.localId, { path }, context.owner)
          ) {
            removePhotoFile(path);
          }
        }
      } catch (error) {
        reportError(error, "sync.photos", {
          data: {
            kind: "album",
            direction: photo.path ? "upload" : "download",
          },
        });
        failure = error;
      }
    }
    if (failure) throw failure;
  }
}
