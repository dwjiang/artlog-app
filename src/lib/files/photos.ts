import { randomUUID } from 'expo-crypto';
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

export async function persistArtworkPhoto(uri: string, localId: string): Promise<string> {
  return moveInto('artwork-photos', uri, localId);
}

/** Moves the full-frame photo and the crop out of the caches so they last until the scan is saved or dismissed. */
export async function persistCapture(
  { photoUri, cropUri, localId }: { photoUri: string; cropUri: string; localId: string },
): Promise<CaptureFiles> {
  return { photoPath: await moveInto('photos', photoUri, localId), cropPath: await moveInto('crops', cropUri, localId) };
}

/** Keeps a label photo captured offline beside the scan until the queue reads it. */
export async function persistLabelPhoto({ photoUri, localId }: { photoUri: string; localId: string }): Promise<string> {
  return moveInto('labels', photoUri, `${localId}-${randomUUID()}`);
}

export function deleteCapture(paths: CapturePaths): void {
  for (const path of [paths.photoPath, paths.cropPath, paths.labelPhotoPath]) {
    if (!path) continue;
    const file = new File(captureFileUri(path));
    if (file.exists) file.delete();
  }
}

/** The label worker removes its source after reading, so it needs its own copy. */
export function copyCaptureLabel(photoPath: string, localId: string): string {
  const directory = new Directory(Paths.document, 'labels');
  directory.create({ intermediates: true, idempotent: true });
  const filename = `${localId}-${randomUUID()}.jpg`;
  new File(captureFileUri(photoPath)).copy(new File(directory, filename));
  return `labels/${filename}`;
}
