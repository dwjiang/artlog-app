import { DocentSection } from "@/components/scan/result/docent-section";
import { useArtworkEnrichment } from "@/lib/use-artwork-enrichment";

import type { Id } from "../../../convex/_generated/dataModel";

/** The audio guide's script appears once a listen has generated it. */
export function GuideTranscript({ artworkId }: { artworkId: Id<"artworks"> }) {
  const enrichment = useArtworkEnrichment(artworkId);
  if (!enrichment || enrichment instanceof Error || !enrichment.narration?.length) return null;
  return (
    <DocentSection title="Audio guide transcript" docent={enrichment.narration} factSheet={enrichment.narrationFacts} />
  );
}
