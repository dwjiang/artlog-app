import { File, Paths } from "expo-file-system";

export function photoFileExists(path: string | null): boolean {
  return !!path && new File(Paths.document, path).exists;
}

export function photoTransferNeeded(path: string | null, storageId: string | null): boolean {
  if (!storageId) return !!path;
  return !photoFileExists(path);
}
