import { StyleSheet, View } from "react-native";

import { HighlightHeading } from "@/components/highlight-heading";
import { ParagraphSkeleton } from "@/components/loading-skeleton";
import { DocentSection } from "@/components/scan/result/docent-section";
import { Spacing } from "@/constants/theme";
import { useArtworkEnrichment } from "@/lib/use-artwork-enrichment";

import type { Id } from "../../../convex/_generated/dataModel";

/** The audio guide's script appears once a listen or a report has it written. */
export function GuideTranscript({ artworkId }: { artworkId: Id<"artworks"> }) {
  const enrichment = useArtworkEnrichment(artworkId);
  if (!enrichment || enrichment instanceof Error) return null;
  const { narration, narrationFacts, narrationWriting } = enrichment;
  if (narration?.length) {
    return (
      <DocentSection
        title={TRANSCRIPT_TITLE}
        docent={narration}
        factSheet={narrationFacts}
        report={{ kind: "transcript", artworkId }}
      />
    );
  }
  if (!narrationWriting) return null;
  return (
    <View style={styles.writing}>
      <HighlightHeading>{TRANSCRIPT_TITLE}</HighlightHeading>
      <ParagraphSkeleton label={TRANSCRIPT_WRITING} />
    </View>
  );
}

export const TRANSCRIPT_TITLE = "Audio guide transcript";
export const TRANSCRIPT_WRITING = "Writing the transcript…";

const styles = StyleSheet.create({
  writing: { gap: Spacing.two, paddingTop: Spacing.one },
});
