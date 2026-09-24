import { Directory, File, Paths } from "expo-file-system";
import { reportError } from "@/lib/observability";

export function removeCameraTempFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (error) {
    reportError(error, "capture.cleanup_temporary_photo", { level: "warning" });
  }
}

export function cleanupCameraTempFiles(now = Date.now()): void {
  try {
    // VisionCamera writes UUID-named stills in the iOS container's tmp directory.
    const directory = new Directory(Paths.document.parentDirectory, "tmp");
    if (!directory.exists) return;
    const cutoff = now - 24 * 60 * 60 * 1000;
    for (const file of directory.list()) {
      if (!(file instanceof File) || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}\.(?:jpe?g|heic)$/i.test(file.name)) {
        continue;
      }
      const modified = file.modificationTime;
      if (modified !== null && modified < cutoff) removeCameraTempFile(file.uri);
    }
  } catch (error) {
    reportError(error, "capture.cleanup_old_photos", { level: "warning" });
  }
}
