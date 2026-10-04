import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat, type ImageRef } from "expo-image-manipulator";

import type { CropContentBounds } from "../../../modules/vision-rect/src";
import { PHOTO_FOLDERS } from "./photo-folders";
import { removeFileIfExists } from "./remove-file";

export type CaptureFiles = { photoPath: string; cropPath: string };
export type CapturePaths = {
  photoPath?: string | null;
  cropPath?: string | null;
  labelPhotoPath?: string | null;
};

function extension(uri: string): string {
  const match = /\.[a-z0-9]+$/i.exec(uri);
  return match ? match[0].toLowerCase() : ".jpg";
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

// Each scan owns a model crop and a sibling preview containing only the artwork.
export function scanPreviewPath(cropPath: string): string {
  return cropPath.replace(/\.[^/.]+$/, "") + ".preview.jpg";
}

export async function persistArtworkPhoto(uri: string, localId: string): Promise<string> {
  return moveInto(PHOTO_FOLDERS.artwork, uri, localId);
}

export async function copyArtworkPhoto(uri: string, localId: string): Promise<string> {
  const directory = new Directory(Paths.document, PHOTO_FOLDERS.artwork);
  directory.create({ intermediates: true, idempotent: true });
  const path = `${PHOTO_FOLDERS.artwork}/${localId}${extension(uri)}`;
  await new File(uri).copy(new File(captureFileUri(path)));
  return path;
}

export async function persistCapture({
  photoUri,
  cropUri,
  localId,
  contentBounds,
}: {
  photoUri: string;
  cropUri: string;
  localId: string;
  contentBounds: CropContentBounds;
}): Promise<CaptureFiles> {
  const context = ImageManipulator.manipulate(cropUri);
  let image: ImageRef | undefined;
  try {
    const { x, y, width, height } = contentBounds;
    image = await context.crop({ originX: x, originY: y, width, height }).renderAsync();
    const preview = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: 1,
    });
    const photoPath = await moveInto(PHOTO_FOLDERS.capture, photoUri, localId);
    const cropPath = await moveInto(PHOTO_FOLDERS.crop, cropUri, localId);
    await new File(preview.uri).move(new File(captureFileUri(scanPreviewPath(cropPath))));
    return { photoPath, cropPath };
  } finally {
    image?.release();
    context.release();
  }
}

/** Keeps a label photo captured offline beside the scan until the queue reads it. */
export async function persistLabelPhoto({ photoUri, localId }: { photoUri: string; localId: string }): Promise<string> {
  return moveInto(PHOTO_FOLDERS.label, photoUri, `${localId}-${randomUUID()}`);
}

export function deleteCapture(paths: CapturePaths): void {
  for (const path of [
    paths.photoPath,
    paths.cropPath,
    paths.cropPath && scanPreviewPath(paths.cropPath),
    paths.labelPhotoPath,
  ]) {
    if (!path) continue;
    removeFileIfExists(captureFileUri(path));
  }
}
