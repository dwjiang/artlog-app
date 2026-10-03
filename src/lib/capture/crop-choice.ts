import { removeFileIfExists } from "@/lib/files/remove-file";
import { isTransientError } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { TimeoutError, withTimeout } from "@/lib/with-timeout";

import { roundVector } from "./features";
import type { CropRanker, Embedder, PreparedPainting } from "./stages";

/** How long ranking may hold up a scan before the likeliest boundary is identified instead. */
export const RANK_TIMEOUT_MS = 3000;

type Timed = <T>(stage: "embed" | "rank", task: () => Promise<T>) => Promise<T>;

/** Embeds every candidate crop and keeps the one `rank` picks, else the first; deletes the other crops' files. */
export async function chooseCrop(
  candidates: PreparedPainting[],
  embedder: Embedder,
  rank: CropRanker | undefined,
  timed: Timed = (_stage, task) => task(),
): Promise<{ painting: PreparedPainting; vector: number[] }> {
  let chosen = 0;
  try {
    const vectors = await timed("embed", async () => {
      const embedded: number[][] = [];
      for (const candidate of candidates) embedded.push(roundVector(await embedder.embed(candidate.cropUri)));
      return embedded;
    });
    if (rank && vectors.length > 1) {
      chosen = await timed("rank", () => rankOrFirst(rank, vectors));
      if (__DEV__) console.debug("Crop choice", { candidates: vectors.length, chosen });
    }
    return { painting: candidates[chosen], vector: vectors[chosen] };
  } finally {
    for (const [index, candidate] of candidates.entries()) {
      if (index !== chosen) removeFileIfExists(candidate.cropUri);
    }
  }
}

async function rankOrFirst(rank: CropRanker, vectors: number[][]): Promise<number> {
  try {
    const index = await withTimeout(rank(vectors), RANK_TIMEOUT_MS, "Crop ranking timed out");
    return Number.isInteger(index) && index >= 0 && index < vectors.length ? index : 0;
  } catch (error) {
    if (!(error instanceof TimeoutError) && !isTransientError(error)) {
      reportError(error, "capture.rank_crops", { level: "warning" });
    }
    return 0;
  }
}
