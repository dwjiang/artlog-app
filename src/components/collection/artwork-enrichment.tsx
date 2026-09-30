import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { TRANSCRIPT_TITLE, TRANSCRIPT_WRITING } from "@/components/audio/guide-transcript";
import { ParagraphSkeleton } from "@/components/loading-skeleton";
import { ReportableHeading } from "@/components/reportable-heading";
import { DocentSection } from "@/components/scan/result/docent-section";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import type { ContentReportTarget } from "@/lib/social/report";
import { useArtworkEnrichment } from "@/lib/use-artwork-enrichment";

import type { Id } from "../../../convex/_generated/dataModel";

export function ArtworkEnrichment({ artworkId }: { artworkId: Id<"artworks"> }) {
  const enrichment = useArtworkEnrichment(artworkId);
  if (!enrichment) return null;
  if (enrichment instanceof Error) {
    return (
      <Section title="About this work">
        <ThemedText themeColor="textSecondary">Details about this work are unavailable right now.</ThemedText>
      </Section>
    );
  }

  const { docent, docentWriting, factSheet, narration, narrationFacts, narrationWriting } = enrichment;
  return (
    <>
      {(!!docent?.length || docentWriting) && (
        <Section title="About this work" report={docent?.length ? { kind: "docent", artworkId } : undefined}>
          <DocentSection docent={docent} factSheet={factSheet} status={docentWriting ? "writing" : undefined} />
        </Section>
      )}
      {!!narration?.length && (
        <Section title={TRANSCRIPT_TITLE} report={{ kind: "transcript", artworkId }}>
          <DocentSection docent={narration} factSheet={narrationFacts} />
        </Section>
      )}
      {narrationWriting && (
        <Section title={TRANSCRIPT_TITLE}>
          <ParagraphSkeleton label={TRANSCRIPT_WRITING} />
        </Section>
      )}
    </>
  );
}

function Section({ title, report, children }: { title: string; report?: ContentReportTarget; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <ReportableHeading report={report}>
        <ThemedText variant="section">{title}</ThemedText>
      </ReportableHeading>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
