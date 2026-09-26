import { getNetworkStateAsync } from "expo-network";

import { captureOwner } from "@/lib/account/owner-store";
import { convex } from "@/lib/convex-client";
import { captureFileUri } from "@/lib/files/photos";
import { removeFileIfExists } from "@/lib/files/remove-file";
import { isOffline } from "@/lib/network-state";
import { reportError } from "@/lib/observability";

import { api } from "../../../convex/_generated/api";
import { albumMatch } from "./album-match";
import { captureOptions, defaultStages } from "./default-stages";
import { extractFeatures } from "./features";
import type { DraftPhoto } from "./photo-draft";

export async function checkAlbumPhoto(
  photo: DraftPhoto,
  targetObjectId?: string,
): Promise<Pick<DraftPhoto, "review" | "recognized">> {
  const session = captureOwner();
  if (!targetObjectId || !session.scope) return { review: "uncertain" };
  let cropUri: string | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const network = await getNetworkStateAsync();
    if (isOffline(network)) return { review: "uncertain" };
    const prepared = await defaultStages.warper.warpAndLetterbox(
      captureFileUri(photo.path),
      null,
      captureOptions.inputSize,
    );
    if (!prepared) return { review: "uncertain" };
    cropUri = prepared.cropUri;
    const features = await extractFeatures(cropUri, defaultStages);
    if (!session.isCurrent()) return { review: "uncertain" };
    const result = await Promise.race([
      convex.action(api.identify.identify, {
        ...features,
        scope: session.scope,
        localId: photo.localId,
        modelVersion: captureOptions.modelVersion,
        capturedAt: photo.capturedAt,
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Recognition timed out")), 15_000);
      }),
    ]);
    const classification = albumMatch(result, targetObjectId);
    return {
      review: classification === "same" ? undefined : classification,
      recognized:
        result.outcome === "confident" && result.best
          ? {
              title: result.best.title,
              artist: result.best.artist,
              objectId: result.best.objectId,
              artworkId: result.best.artworkId,
            }
          : undefined,
    };
  } catch (error) {
    reportError(error, "capture.check_album_photo", { level: "warning" });
    return { review: "uncertain" };
  } finally {
    clearTimeout(timeout);
    if (cropUri) {
      removeFileIfExists(cropUri);
    }
  }
}
