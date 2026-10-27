import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import { JUDGES_DEMO_FILES, JUDGES_DEMO_FOLDER } from "@/shared/capture/judges-demo";

import type { PickedPhoto } from "./use-capture";

const IMAGE = /\.(jpe?g|png|heic)$/i;

export type DemoPhotos = { gallery: string[]; uploads: string[] };

/** The judges' demo photos: gallery stills in name order, then uploads newest first (the host names them by time). */
export function listDemoPhotos(): DemoPhotos {
  const folder = new Directory(Paths.document, JUDGES_DEMO_FOLDER);
  const gallery = images(new Directory(folder, JUDGES_DEMO_FILES.photos));
  const uploads = images(new Directory(folder, JUDGES_DEMO_FILES.uploads));
  return {
    gallery: gallery.sort((a, b) => a.name.localeCompare(b.name)).map((file) => file.uri),
    uploads: uploads.sort((a, b) => b.name.localeCompare(a.name)).map((file) => file.uri),
  };
}

function images(directory: Directory): File[] {
  if (!directory.exists) return [];
  return directory.list().filter((entry): entry is File => entry instanceof File && IMAGE.test(entry.name));
}

/** The import consumes the photo it is given, so it gets a copy and the demo photo stays for the next judge. */
export async function copyForImport(uri: string): Promise<PickedPhoto> {
  const source = new File(uri);
  const copy = new File(Paths.cache, `${randomUUID()}.${source.extension.replace(/^\./, "") || "jpg"}`);
  await source.copy(copy);
  return { uri: copy.uri };
}
