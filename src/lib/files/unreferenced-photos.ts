import { isPhotoFileReferenced } from '@/db/repos/saved-works';
import { removePhotoFile } from '@/lib/account/photo-transfer';
import { reportError } from '@/lib/observability';

/** Best effort: a file that cannot be removed must not fail the save or sync that orphaned it. */
export async function removeUnreferencedPhotos(paths: Iterable<string>): Promise<void> {
  for (const path of new Set(paths)) {
    try { if (!await isPhotoFileReferenced(path)) removePhotoFile(path); }
    catch (error) { reportError(error, 'storage.cleanup', { level: 'warning' }); console.warn('Could not remove an unused photo file', error); }
  }
}
