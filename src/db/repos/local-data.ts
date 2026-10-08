import { db } from "@/db/client";
import {
  artworkEncounters,
  artworkPhotos,
  offlineScanResults,
  pendingScans,
  savedWorks,
  settings,
  visits,
} from "@/db/schema";

/** Every owner's journal, queued scans and preferences, children first so the foreign keys hold throughout. */
export function deleteAllLocalData(): void {
  db.transaction((tx) => {
    for (const table of [
      offlineScanResults,
      pendingScans,
      artworkPhotos,
      artworkEncounters,
      savedWorks,
      visits,
      settings,
    ]) {
      tx.delete(table).run();
    }
  });
}
