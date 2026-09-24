import { cacheOfflineResult } from "@/db/repos/offline-scan-results";
import { captureOwner } from "@/lib/account/owner-store";
import type { CapturePayload } from "@/lib/capture/stages";

import { identifyOffline } from "./identify-offline";

export async function recognizeOfflineCapture(
  payload: Pick<
    CapturePayload,
    "owner" | "localId" | "vector" | "descriptors" | "keypoints" | "modelVersion" | "venueId"
  >,
): Promise<void> {
  const current = captureOwner();
  if (current.owner !== payload.owner) return;
  const result = await identifyOffline(payload);
  if (result && current.isOwnerCurrent()) {
    await cacheOfflineResult(payload.localId, result, current.owner);
  }
}
