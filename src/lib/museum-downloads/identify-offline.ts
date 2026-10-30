import type { CapturePayload } from "@/lib/capture/stages";
import { reportError } from "@/lib/observability";
import { rankEntries, recognizeEntries } from "@/shared/offline/recognition";
import type { MuseumEntry } from "@/shared/offline/types";

import type { LocalPackage } from "./model";
import { museumDownloads, readEntries } from "./storage";

export async function identifyOffline(
  payload: Pick<CapturePayload, "vector" | "descriptors" | "keypoints" | "modelVersion" | "venueId">,
) {
  await museumDownloads.hydrate();
  let candidates: MuseumEntry[] = [];
  for (const row of Object.values(museumDownloads.getSnapshot().downloads)) {
    const pack = row.active;
    if (!pack || pack.manifest.modelVersion !== payload.modelVersion) continue;
    // A package file truncated by a kill mid-write passes the hydration existence check, so skipping
    // the museum here keeps one damaged download from hiding every other museum on this phone.
    candidates = await rankPackage(payload.vector, pack, candidates).catch((error: unknown) => {
      reportError(error, "capture.offline_package_unreadable", {
        level: "warning",
        data: { chunk_count: pack.manifest.chunks.length },
      });
      return candidates;
    });
  }
  return recognizeEntries(payload, candidates);
}

async function rankPackage(vector: number[], pack: LocalPackage, previous: MuseumEntry[]): Promise<MuseumEntry[]> {
  let candidates = previous;
  for (let index = 0; index < pack.manifest.chunks.length; index++) {
    candidates = rankEntries(vector, await readEntries(pack, index), candidates);
    // Yield between chunks so a large museum does not lock camera/result transitions.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return candidates;
}
