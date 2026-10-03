import { getNetworkStateAsync } from "expo-network";

import { captureOwner } from "@/lib/account/owner-store";
import { convex } from "@/lib/convex-client";
import { captureFileUri } from "@/lib/files/photos";
import { removeFileIfExists } from "@/lib/files/remove-file";
import { isOffline } from "@/lib/network-state";
import { reportError } from "@/lib/observability";
import { withTimeout } from "@/lib/with-timeout";

import { api } from "../../../convex/_generated/api";
import { albumMatch } from "./album-match";
import { chooseCrop } from "./crop-choice";
import { captureOptions, defaultStages } from "./default-stages";
import type { DraftPhoto } from "./photo-draft";
import type { PreparedPainting } from "./stages";

export async function checkAlbumPhoto(
  photo: DraftPhoto,
  targetObjectId?: string,
): Promise<Pick<DraftPhoto, "review" | "recognized">> {
  const session = captureOwner();
  if (!targetObjectId || !session.scope) return { review: "uncertain" };
  let candidates: PreparedPainting[] = [];
  try {
    const network = await getNetworkStateAsync();
    if (isOffline(network)) return { review: "uncertain" };
    candidates = await defaultStages.warper.warpCandidates(
      captureFileUri(photo.path),
      null,
      captureOptions.inputSize,
      true,
    );
    if (candidates.length === 0) return { review: "uncertain" };
    const { painting, vector } = await chooseCrop(candidates, defaultStages.embedder, (vectors) =>
      convex.action(api.identify.rankCrops, { vectors, modelVersion: captureOptions.modelVersion }),
    );
    const features = await defaultStages.orb.extract(painting.cropUri);
    if (!session.isCurrent()) return { review: "uncertain" };
    const result = await withTimeout(
      convex.action(api.identify.identify, {
        vector,
        descriptors: features.descriptors,
        keypoints: features.keypoints,
        scope: session.scope,
        localId: photo.localId,
        modelVersion: captureOptions.modelVersion,
        capturedAt: photo.capturedAt,
      }),
      15_000,
      "Recognition timed out",
    );
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
    for (const candidate of candidates) removeFileIfExists(candidate.cropUri);
  }
}
