import { useQueries, type RequestForQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useDeviceReady } from "./use-device-ready";

export type ArtworkEnrichment = FunctionReturnType<typeof api.artworks.enrichment>;

/** Undefined until the device is registered and the query answers; an Error when it fails. */
export function useArtworkEnrichment(artworkId: Id<"artworks">): ArtworkEnrichment | Error | undefined {
  const ready = useDeviceReady();
  const queries = useMemo(
    (): RequestForQueries => (ready ? { enrichment: { query: api.artworks.enrichment, args: { artworkId } } } : {}),
    [artworkId, ready],
  );
  const { enrichment }: { enrichment?: ArtworkEnrichment | Error } = useQueries(queries);
  return enrichment;
}
