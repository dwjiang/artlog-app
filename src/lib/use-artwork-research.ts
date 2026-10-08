import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { isNetworkError } from "./network-error";
import { reportError } from "./observability";
import { useArtworkEnrichment } from "./use-artwork-enrichment";

/** Asks once per visit to a work's page for the "About this work" research it has never had; true while it is written. */
export function useArtworkResearch(artworkId: Id<"artworks">): boolean {
  const enrichment = useArtworkEnrichment(artworkId);
  const story = enrichment instanceof Error ? undefined : enrichment;
  const needed = !!story && !story.docent?.length && !story.docentWriting;
  const generation = story?.docentGeneration;
  const start = useMutation(api.artworks.research);
  const asked = useRef(false);
  const [requestedGeneration, setRequestedGeneration] = useState<number>();
  useEffect(() => {
    if (!needed || generation === undefined || asked.current) return;
    asked.current = true;
    start({ artworkId })
      .then((started) => {
        if (started) setRequestedGeneration(generation);
      })
      .catch((cause) => {
        if (!isNetworkError(cause)) reportError(cause, "artwork.research");
      });
  }, [artworkId, needed, generation, start]);
  // Claiming advances the generation even if the client misses the whole run while disconnected.
  return !!story?.docentWriting || (requestedGeneration !== undefined && generation === requestedGeneration);
}
