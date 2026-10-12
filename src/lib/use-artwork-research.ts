import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { DocentStatus } from "../../convex/lib/validators";
import { isNetworkError } from "./network-error";
import { reportError } from "./observability";
import { useArtworkEnrichment } from "./use-artwork-enrichment";

export type ArtworkResearch = {
  /** Undefined while there is a story, or none was asked for or the backend declined to write one. */
  status?: Extract<DocentStatus, "writing" | "failed">;
  /** Asks again after a failed run; rejects when the request cannot reach the server. */
  retry: () => Promise<void>;
};

/** Asks once per visit to a work's page for the "About this work" research it has never had, and again on retry. */
export function useArtworkResearch(artworkId: Id<"artworks">): ArtworkResearch {
  const enrichment = useArtworkEnrichment(artworkId);
  const story = enrichment instanceof Error ? undefined : enrichment;
  const written = !!story?.docent?.length;
  const needed = !!story && !written && !story.docentWriting;
  const generation = story?.docentGeneration;
  const start = useMutation(api.artworks.research);
  const asked = useRef(false);
  const [requestedGeneration, setRequestedGeneration] = useState<number>();
  // A run this page saw end without a story failed; the backend releases a stale claim the same way.
  const [followed, setFollowed] = useState(false);
  // The backend declined a Try again: the work can't be researched again, so there is nothing to retry.
  const [declined, setDeclined] = useState(false);
  // Claiming advances the generation even if the client misses the whole run while disconnected.
  const writing =
    !written && (!!story?.docentWriting || (requestedGeneration !== undefined && generation === requestedGeneration));
  if (writing && !followed) setFollowed(true);

  // An open leaves a recently failed run alone; Try again asks the backend to run it at once.
  const ask = useCallback(
    async (retry: boolean) => {
      const started = await start(retry ? { artworkId, retry } : { artworkId });
      setFollowed(started);
      setDeclined(retry && !started);
      if (started) setRequestedGeneration(generation);
    },
    [artworkId, generation, start],
  );

  useEffect(() => {
    // A run this visit already saw is its attempt; after a failure only Try again asks once more.
    if (!needed || generation === undefined || asked.current || followed) return;
    asked.current = true;
    ask(false).catch((cause) => {
      if (!isNetworkError(cause)) reportError(cause, "artwork.research");
    });
  }, [needed, generation, followed, ask]);

  // The backend says whether the last run failed, including one before this visit that an open leaves alone for
  // a while; a work it cannot research again (no sources, held for review) ended rather than failed.
  const failed = needed && !declined && story?.docentStatus === "failed";
  return { status: writing ? "writing" : failed ? "failed" : undefined, retry: () => ask(true) };
}
