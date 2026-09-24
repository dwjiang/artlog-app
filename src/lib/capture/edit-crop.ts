import { and, eq } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { getNetworkStateAsync } from "expo-network";

import { db } from "@/db/client";
import { getPendingScan } from "@/db/repos/pending-scans";
import { getSavedWork, replaceSavedCrop } from "@/db/repos/saved-works";
import { pendingScans } from "@/db/schema";
import { captureOwner } from "@/lib/account/owner-store";
import { removePhotoFile } from "@/lib/account/photo-transfer";
import { embedder } from "@/lib/embed/embedder";
import { filePath } from "@/lib/file-uri";
import { captureFileUri, copyArtworkPhoto, scanPreviewPath } from "@/lib/files/photos";
import { removeUnreferencedPhotos } from "@/lib/files/unreferenced-photos";
import { recognizeOfflineCapture } from "@/lib/museum-downloads/recognize-capture";
import model from "@/shared/model/model-version.json";

import { getVisionRect } from "../../../modules/vision-rect/src";
import { validCrop } from "./crop-geometry";
import { extractFeatures, orb } from "./features";
import { clearPhotoDraft, readPhotoSession, updatePhotoSession } from "./photo-draft";
import { toCorners } from "./rectangle";
import type { Quad } from "./stages";

export type EditedCrop = {
  modelUri: string;
  previewUri: string;
  width: number;
  height: number;
};

export function discardEditedCrop(crop: EditedCrop) {
  for (const uri of [crop.modelUri, crop.previewUri]) {
    const file = new File(uri);
    if (file.exists) file.delete();
  }
}

export async function prepareEditedCrop(photoPath: string, corners: Quad): Promise<EditedCrop> {
  if (!validCrop(corners)) {
    throw new Error("Choose four corners around the painting.");
  }
  const result = await getVisionRect().warpAndLetterbox(
    filePath(captureFileUri(photoPath)),
    toCorners(corners),
    model.inputSize,
  );
  const modelUri = `file://${result.cropPath}`;
  const context = ImageManipulator.manipulate(modelUri);
  let image;
  try {
    const { x, y, width, height } = result.contentBounds;
    image = await context.crop({ originX: x, originY: y, width, height }).renderAsync();
    const preview = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: 1,
    });
    return { modelUri, previewUri: preview.uri, width, height };
  } catch (error) {
    const file = new File(modelUri);
    if (file.exists) file.delete();
    throw error;
  } finally {
    image?.release();
    context.release();
  }
}

export async function saveEditedArtworkCrop(savedId: string, crop: EditedCrop, owner: string, isCurrent = () => true) {
  const current = captureOwner();
  const work = await getSavedWork(savedId, owner);
  if (current.owner !== owner || !work || work.deletedAt !== null) {
    throw new Error("Artwork unavailable");
  }
  if (!current.isOwnerCurrent() || !isCurrent()) {
    throw new Error("Crop edit cancelled");
  }
  const path = await copyArtworkPhoto(crop.previewUri, randomUUID());
  try {
    if (!current.isOwnerCurrent() || !isCurrent()) {
      throw new Error("Journal owner changed");
    }
    replaceSavedCrop(savedId, path, owner);
  } catch (error) {
    removePhotoFile(path);
    throw error;
  }
  if (work.cropPath) await removeUnreferencedPhotos([work.cropPath]);
}

/** A new scan id prevents an in-flight response for the old crop from becoming the corrected result. */
export async function saveEditedScanCrop(
  localId: string,
  crop: EditedCrop,
  owner: string,
  isCurrent = () => true,
): Promise<string> {
  const current = captureOwner();
  const capture = await getPendingScan(localId, owner);
  if (current.owner !== owner || !capture) throw new Error("Scan unavailable");
  const features = await extractFeatures(crop.modelUri, { embedder, orb });
  if (!current.isOwnerCurrent() || !isCurrent()) {
    throw new Error("Journal owner changed");
  }
  const nextId = randomUUID();
  const modelPath = await copyArtworkPhoto(crop.modelUri, nextId);
  const previewPath = scanPreviewPath(modelPath);
  let photoPath: string | undefined;
  try {
    await new File(crop.previewUri).copy(new File(captureFileUri(previewPath)));
    photoPath = await copyArtworkPhoto(captureFileUri(capture.photoPath), `${nextId}-full`);
    if (!current.isOwnerCurrent() || !isCurrent()) {
      throw new Error("Journal owner changed");
    }
    db.transaction((tx) => {
      const original = tx
        .select()
        .from(pendingScans)
        .where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)))
        .get();
      if (!original || original.cropPath !== capture.cropPath) {
        throw new Error("Scan changed. Reopen it and try again.");
      }
      tx.insert(pendingScans)
        .values({
          ...original,
          ...features,
          localId: nextId,
          photoPath: photoPath!,
          cropPath: modelPath,
          modelVersion: model.modelVersion,
          scanId: null,
          status: "queued",
          attempts: 0,
          lastError: null,
          attemptModelVersion: model.modelVersion,
          createdAt: Date.now(),
        })
        .run();
      tx.delete(pendingScans)
        .where(and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId)))
        .run();
      updatePhotoSession(owner, photoPath!, {
        ...readPhotoSession(owner, capture.photoPath),
        saveInput: undefined,
      });
      clearPhotoDraft(owner, capture.photoPath);
    });
  } catch (error) {
    removePhotoFile(modelPath);
    removePhotoFile(previewPath);
    if (photoPath) removePhotoFile(photoPath);
    throw error;
  }
  await removeUnreferencedPhotos([capture.photoPath, capture.cropPath, scanPreviewPath(capture.cropPath)]);
  void recognizeUnsendableCrop(
    {
      ...features,
      owner,
      localId: nextId,
      modelVersion: model.modelVersion,
      venueId: capture.venueId ?? undefined,
    },
    current.scope,
  ).catch((error) => console.warn("Offline identification unavailable; edited capture stays queued", error));
  return nextId;
}

// Like runCapture, a local match only stands in for a scan the queue cannot send; the editor flushes the queue on return.
async function recognizeUnsendableCrop(
  payload: Parameters<typeof recognizeOfflineCapture>[0],
  scope: string | undefined,
) {
  if (scope && (await getNetworkStateAsync()).isInternetReachable !== false) {
    return;
  }
  await recognizeOfflineCapture(payload);
}
