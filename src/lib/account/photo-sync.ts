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
    for (const work of pending) {
      for (const kind of ['crop', 'photo'] as const) {
        if (!isCurrent()) return;
        const current = await deps.getSavedWork(work.localId);
        if (!isCurrent()) return;
        if (!current || current.deletedAt !== null) break;
        const path = current[`${kind}Path`], storageId = current[`${kind}StorageId`];
        try {
          if (path && !storageId) {
            const uploaded = await deps.upload(work.localId, kind, path);
            if (!isCurrent()) return;
            await deps.updatePhotoTransfer(work.localId, { [`${kind}StorageId`]: uploaded });
          } else if (!path && storageId) {
            const downloaded = await deps.download(work.localId, kind, storageId);
            if (!isCurrent() || !await deps.updatePhotoTransfer(work.localId, { [`${kind}Path`]: downloaded })) {
              deps.removeFile(downloaded);
            }
          }
        } catch (error) { failure = error; }
      }
    }
    if (failure) throw failure;
  }
}
