import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { getNetworkStateAsync } from "expo-network";

import { db } from "@/db/client";
import { getPendingScan } from "@/db/repos/pending-scans";
import { getSavedWork, replaceSavedCrop } from "@/db/repos/saved-works";
import { pendingScans, savedWorks } from "@/db/schema";
import { captureOwner, getLocalOwner } from "@/lib/account/owner-store";
import { removePhotoFile } from "@/lib/account/photo-transfer";
import { embedder } from "@/lib/embed/embedder";
import { tagFailure } from "@/lib/failure-step";
import { filePath } from "@/lib/file-uri";
import { captureFileUri, copyArtworkPhoto, scanPreviewPath } from "@/lib/files/photos";
import { removeFileIfExists } from "@/lib/files/remove-file";
import { removeUnreferencedPhotos } from "@/lib/files/unreferenced-photos";
import { recognizeOfflineCapture } from "@/lib/museum-downloads/recognize-capture";
import { isOffline } from "@/lib/network-state";
import { reportError } from "@/lib/observability";
import { withTimeout } from "@/lib/with-timeout";
import model from "@/shared/model/model-version.json";

import { getVisionRect } from "../../../modules/vision-rect/src";
import { validCrop } from "./crop-geometry";
import { extractFeatures, orb } from "./features";
import { clearPhotoDraft, readPhotoSession, updatePhotoSession } from "./photo-draft";
import { maxCornerDistance, toCorners, toQuad } from "./rectangle";
import { snapToReference } from "./snap-crop";
import type { IdentifyResponse, Quad } from "./stages";

/** A thumbnail slower than this leaves the identified crop rather than delay the result. */
const SNAP_THUMBNAIL_TIMEOUT_MS = 1500;
/** Normalized corner movement below which a snapped crop is the identified one. */
const SNAP_MIN_CHANGE = 0.005;

export type EditedCrop = {
  modelUri: string;
  previewUri: string;
  width: number;
  height: number;
  /** The photo the crop was cut from, and where in it, normalized. */
  photoPath: string;
  corners: Quad;
};

export function discardEditedCrop(crop: EditedCrop) {
  for (const uri of [crop.modelUri, crop.previewUri]) {
    removeFileIfExists(uri);
  }
}

export async function prepareEditedCrop(photoPath: string, corners: Quad): Promise<EditedCrop> {
  if (!validCrop(corners)) {
    throw new Error("Choose four corners around the painting.");
  }
  const result = await getVisionRect()
    .warpAndLetterbox(filePath(captureFileUri(photoPath)), toCorners(corners), model.inputSize)
    .catch((error: unknown) => {
      tagFailure(error, { step: "warp" });
      throw error;
    });
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
    return { modelUri, previewUri: preview.uri, width, height, photoPath, corners: toQuad(result.usedQuad) };
  } catch (error) {
    tagFailure(error, { step: "render_preview" });
    removeFileIfExists(modelUri);
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
  const path = await copyArtworkPhoto(crop.previewUri, randomUUID()).catch((error: unknown) => {
    tagFailure(error, { step: "copy_files", target: "artwork" });
    throw error;
  });
  try {
    if (!current.isOwnerCurrent() || !isCurrent()) {
      throw new Error("Journal owner changed");
    }
    replaceSavedCrop(savedId, path, crop.corners, crop.photoPath, owner);
  } catch (error) {
    tagFailure(error, { step: "db_write", target: "artwork" });
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
  const features = await extractFeatures(crop.modelUri, { embedder, orb }).catch((error: unknown) => {
    tagFailure(error, { step: "extract_features", target: "scan" });
    throw error;
  });
  if (!current.isOwnerCurrent() || !isCurrent()) {
    throw new Error("Journal owner changed");
  }
  const nextId = randomUUID();
  let step = "copy_files";
  const modelPath = await copyArtworkPhoto(crop.modelUri, nextId).catch((error: unknown) => {
    tagFailure(error, { step, target: "scan" });
    throw error;
  });
  const previewPath = scanPreviewPath(modelPath);
  let photoPath: string | undefined;
  try {
    await new File(crop.previewUri).copy(new File(captureFileUri(previewPath)));
    photoPath = await copyArtworkPhoto(captureFileUri(capture.photoPath), `${nextId}-full`);
    if (!current.isOwnerCurrent() || !isCurrent()) {
      throw new Error("Journal owner changed");
    }
    step = "db_write";
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
          savedPhotoLocalId: null,
          photoPath: photoPath!,
          cropPath: modelPath,
          cropCorners: crop.corners,
          // A user-selected boundary must not be replaced when queued recognition completes.
          modelCropGeometry: null,
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
    tagFailure(error, { step, target: "scan" });
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
  ).catch((error: unknown) =>
    reportError(error, "capture.recognize_offline", { level: "warning", data: { edited: true } }),
  );
  return nextId;
}

// Like runCapture, a local match only stands in for a scan the queue cannot send; the editor flushes the queue on return.
async function recognizeUnsendableCrop(
  payload: Parameters<typeof recognizeOfflineCapture>[0],
  scope: string | undefined,
) {
  if (scope && !isOffline(await getNetworkStateAsync())) {
    return;
  }
  await recognizeOfflineCapture(payload);
}

/**
 * Recuts a matched scan's displayed crop to the painting's own edges, which the verified match against its catalogue
 * image locates whatever the identified crop kept or cut. The model crop and its features stay as identified.
 */
export async function snapScanCrop(
  localId: string,
  match: IdentifyResponse["best"],
  owner = getLocalOwner(),
): Promise<void> {
  if (!match?.thumbnailCorners || !match.thumbnailUrl) return;
  const current = captureOwner();
  const capture = await getPendingScan(localId, owner);
  if (current.owner !== owner || !capture?.modelCropGeometry) return;
  const { corners: cropCorners, contentBounds } = capture.modelCropGeometry;
  const corners = snapToReference({
    referenceCorners: match.thumbnailCorners,
    referenceSize: await withTimeout(
      imageSize(match.thumbnailUrl),
      SNAP_THUMBNAIL_TIMEOUT_MS,
      "Thumbnail load timed out",
    ),
    cropCorners,
    contentBounds,
    inputSize: model.inputSize,
  });
  if (
    !corners
    || maxCornerDistance(corners, capture.cropCorners ?? cropCorners, { width: 1, height: 1 }) < SNAP_MIN_CHANGE
  ) {
    return;
  }
  if (!current.isOwnerCurrent()) return;
  const crop = await prepareEditedCrop(capture.photoPath, corners);
  // A new crop path names the new preview beside it, so no image cache keeps showing the old one.
  let cropPath: string | undefined;
  let replaced = false;
  try {
    const snappedPath = await copyArtworkPhoto(captureFileUri(capture.cropPath), randomUUID());
    cropPath = snappedPath;
    await new File(crop.previewUri).copy(new File(captureFileUri(scanPreviewPath(snappedPath))));
    replaced =
      current.isOwnerCurrent()
      && db.transaction((tx) => {
        const scan = and(eq(pendingScans.owner, owner), eq(pendingScans.localId, localId));
        // An edit made while the snap was cutting wins.
        if (tx.select().from(pendingScans).where(scan).get()?.cropPath !== capture.cropPath) return false;
        tx.update(pendingScans).set({ cropPath: snappedPath, cropCorners: crop.corners }).where(scan).run();
        // A scan can be saved while offline. Only replace a saved preview that still uses this crop.
        const saved = tx
          .select()
          .from(savedWorks)
          .where(
            and(
              eq(savedWorks.owner, owner),
              isNull(savedWorks.deletedAt),
              eq(savedWorks.photoPath, capture.photoPath),
              eq(savedWorks.cropPath, scanPreviewPath(capture.cropPath)),
            ),
          )
          .all();
        for (const work of saved) {
          replaceSavedCrop(work.localId, scanPreviewPath(snappedPath), crop.corners, capture.photoPath, owner);
        }
        return true;
      });
  } finally {
    discardEditedCrop(crop);
    if (!replaced && cropPath) {
      removePhotoFile(cropPath);
      removePhotoFile(scanPreviewPath(cropPath));
    }
  }
  if (replaced) await removeUnreferencedPhotos([capture.cropPath, scanPreviewPath(capture.cropPath)]);
}

async function imageSize(uri: string): Promise<{ width: number; height: number }> {
  const image = await Image.loadAsync(uri);
  try {
    return { width: image.width, height: image.height };
  } finally {
    image.release();
  }
}
