import { Directory, File, Paths, UploadType } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import type { Id } from "../../../convex/_generated/dataModel";
import {
  COLLECTION_PHOTO_LONG_SIDE,
  MAX_COLLECTION_PHOTO_BYTES,
  type CollectionPhotoKind,
} from "../../../shared/collection/photo-limits";
import { captureFileUri } from "../files/photos";

export type PhotoUpload = { storageId: Id<"_storage">; photoUpdatedAt: number };

function endpoint(
  scope: string,
  localId: string,
  kind: CollectionPhotoKind,
  photoId?: string,
): string {
  const site = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
  if (!site) throw new Error("EXPO_PUBLIC_CONVEX_SITE_URL is not configured");
  const url = new URL("/collection-photo", site);
  url.searchParams.set("scope", scope);
  url.searchParams.set("localId", localId);
  url.searchParams.set("kind", kind);
  if (photoId) url.searchParams.set("photoId", photoId);
  return url.href;
}

export async function uploadCollectionPhoto(
  token: string,
  scope: string,
  localId: string,
  kind: CollectionPhotoKind,
  path: string,
  isCurrent = () => true,
  photoId?: string,
): Promise<PhotoUpload> {
  const context = ImageManipulator.manipulate(captureFileUri(path));
  const source = await context.renderAsync();
  const longSide = kind === "photo" ? COLLECTION_PHOTO_LONG_SIDE : 512;
  const resize = ImageManipulator.manipulate(source);
  let rendered = source;
  let file: File | undefined;
  try {
    if (Math.max(source.width, source.height) > longSide) {
      rendered = await resize
        .resize(
          source.width >= source.height
            ? { width: longSide }
            : { height: longSide },
        )
        .renderAsync();
    }
    // Re-encoding the rendered image omits the original camera and location metadata.
    const encoded = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.85,
    });
    file = new File(encoded.uri);
    if (file.size > MAX_COLLECTION_PHOTO_BYTES) {
      throw new Error("Photo exceeds the upload limit");
    }
    if (!isCurrent()) throw new Error("Photo upload cancelled");
    const response = await file.upload(
      endpoint(scope, localId, kind, photoId),
      {
        httpMethod: "POST",
        uploadType: UploadType.BINARY_CONTENT,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "image/jpeg",
          "X-Photo-Width": String(rendered.width),
          "X-Photo-Height": String(rendered.height),
        },
      },
    );
    if (response.status !== 200) {
      throw new Error(`Photo upload failed with HTTP ${response.status}`);
    }
    const result = JSON.parse(response.body) as PhotoUpload;
    if (!result.storageId || !Number.isFinite(result.photoUpdatedAt)) {
      throw new Error("Photo upload did not return a storage reference");
    }
    return result;
  } finally {
    if (file?.exists) file.delete();
    if (rendered !== source) rendered.release();
    resize.release();
    source.release();
    context.release();
  }
}

export async function downloadCollectionPhoto(
  token: string,
  scope: string,
  localId: string,
  kind: CollectionPhotoKind,
  storageId: Id<"_storage">,
  photoId?: string,
): Promise<string> {
  const directory = new Directory(Paths.document, "collection-photos");
  directory.create({ intermediates: true, idempotent: true });
  const path = `collection-photos/${encodeURIComponent(scope)}-${encodeURIComponent(localId)}-${photoId ?? kind}-${storageId}.jpg`;
  await File.downloadFileAsync(
    endpoint(scope, localId, kind, photoId),
    new File(captureFileUri(path)),
    {
      headers: { Authorization: `Bearer ${token}` },
      idempotent: true,
    },
  );
  return path;
}

export function removePhotoFile(path: string): void {
  const file = new File(captureFileUri(path));
  if (file.exists) file.delete();
}
