import { Directory, File, Paths } from "expo-file-system";
import { listKeptPhotos } from "@/db/repos/kept-photos";
import { getSetting, setSetting } from "@/db/repos/settings";
import { reportError } from "@/lib/observability";
import { cleanupCameraTempFiles } from "./camera-temp";
import { keepPhotos, type KeptPhoto } from "./kept-photos";

const EXISTING_ORIGINALS = "existing-photo-originals";
let running: Promise<void> | undefined;

async function maintainPhotos(): Promise<void> {
  cleanupCameraTempFiles();
  try {
    const saved = listKeptPhotos();
    let existing: KeptPhoto[];
    const stored = await getSetting(EXISTING_ORIGINALS);
    if (stored !== undefined) existing = JSON.parse(stored) as KeptPhoto[];
    else {
      // Snapshot the pre-existing originals once, including old scans still in the queue.
      // Later launches only add newly kept photos; unsaved captures keep their originals.
      const kinds = new Map(saved.map((photo) => [photo.path, photo.kind]));
      existing = [];
      const directory = new Directory(Paths.document, "photos");
      if (directory.exists) {
        for (const file of directory.list()) {
          if (!(file instanceof File) || !/\.(?:jpe?g|png|heic)$/i.test(file.name)) continue;
          const path = `photos/${file.name}`;
          existing.push({ path, kind: kinds.get(path) ?? "full" });
        }
      }
      await setSetting(EXISTING_ORIGINALS, JSON.stringify(existing));
    }
    const photos = new Map([...existing, ...saved].map((photo) => [photo.path, photo]));
    await keepPhotos([...photos.values()]);
  } catch (error) {
    reportError(error, "photos.startup_maintenance", { level: "warning" });
  }
}

export function maintainStoredPhotos(): Promise<void> {
  running ??= maintainPhotos().finally(() => {
    running = undefined;
  });
  return running;
}
