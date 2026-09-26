import { File } from "expo-file-system";

export function removeFileIfExists(fileOrUri: File | string): void {
  const file = typeof fileOrUri === "string" ? new File(fileOrUri) : fileOrUri;
  if (file.exists) file.delete();
}
