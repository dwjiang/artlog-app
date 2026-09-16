import type { Id } from '../../../convex/_generated/dataModel';
import type { CollectionPhotoKind } from '../../../shared/collection/photo-limits';
import type * as repository from '../../db/repos/saved-works';

export type PhotoSyncDependencies = Pick<typeof repository,
  'listPhotoTransfers' | 'getSavedWork' | 'updatePhotoTransfer' | 'listDeletedPhotoFiles' | 'isPhotoFileReferenced' | 'clearDeletedPhotoPaths'> & {
  upload: (localId: string, kind: CollectionPhotoKind, path: string) => Promise<Id<'_storage'>>;
  download: (localId: string, kind: CollectionPhotoKind, storageId: Id<'_storage'>) => Promise<string>;
  removeFile: (path: string) => void;
};

export async function syncCollectionPhotos(deps: PhotoSyncDependencies, isCurrent = () => true): Promise<void> {
  while (isCurrent()) {
    const deleted = await deps.listDeletedPhotoFiles();
    if (!deleted.length) break;
    for (const work of deleted) {
      for (const path of new Set([work.photoPath, work.cropPath])) {
        if (!isCurrent()) return;
        if (path && !await deps.isPhotoFileReferenced(path)) deps.removeFile(path);
      }
      await deps.clearDeletedPhotoPaths(work.localId);
    }
  }
  while (isCurrent()) {
    const pending = await deps.listPhotoTransfers();
    if (!pending.length) return;
    let failure: unknown;
    // Only the crop travels with the save; the full photo is an album row and transfers with the album.
    for (const work of pending) {
      if (!isCurrent()) return;
      const current = await deps.getSavedWork(work.localId);
      if (!isCurrent()) return;
      if (!current || current.deletedAt !== null) continue;
      try {
        if (current.cropPath && !current.cropStorageId) {
          const uploaded = await deps.upload(work.localId, 'crop', current.cropPath);
          if (!isCurrent()) return;
          await deps.updatePhotoTransfer(work.localId, { cropStorageId: uploaded });
        } else if (!current.cropPath && current.cropStorageId) {
          const downloaded = await deps.download(work.localId, 'crop', current.cropStorageId);
          if (!isCurrent() || !await deps.updatePhotoTransfer(work.localId, { cropPath: downloaded })) deps.removeFile(downloaded);
        }
      } catch (error) { failure = error; }
    }
    if (failure) throw failure;
  }
}
