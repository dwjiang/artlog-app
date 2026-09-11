import { Directory, File, Paths } from 'expo-file-system';

export type CaptureFiles = { photoPath: string; cropPath: string };
export type CapturePaths = { photoPath?: string | null; cropPath?: string | null; labelPhotoPath?: string | null };

function extension(uri: string): string {
  const match = /\.[a-z0-9]+$/i.exec(uri);
  return match ? match[0].toLowerCase() : '.jpg';
}

async function moveInto(folder: string, uri: string, localId: string): Promise<string> {
  const directory = new Directory(Paths.document, folder);
  directory.create({ intermediates: true, idempotent: true });
  const filename = `${localId}${extension(uri)}`;
  const target = new File(directory, filename);
  await new File(uri).move(target);
  return `${folder}/${filename}`;
}

// iOS can move the data container during an update; only resolve its URI when using a file.
export function captureFileUri(path: string): string {
  return new File(Paths.document, path).uri;
}

/** Moves the full-frame photo and the crop out of the caches so they last until the scan is saved or dismissed. */
export async function persistCapture(
  { photoUri, cropUri, localId }: { photoUri: string; cropUri: string; localId: string },
): Promise<CaptureFiles> {
  return { photoPath: await moveInto('photos', photoUri, localId), cropPath: await moveInto('crops', cropUri, localId) };
}

export function deleteCapture(paths: CapturePaths): void {
  for (const path of [paths.photoPath, paths.cropPath, paths.labelPhotoPath]) {
    if (!path) continue;
    const file = new File(captureFileUri(path));
    if (file.exists) file.delete();
  }
}
