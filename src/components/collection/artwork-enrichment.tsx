import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { TRANSCRIPT_TITLE, TRANSCRIPT_WRITING } from "@/components/audio/guide-transcript";
import { ParagraphSkeleton } from "@/components/loading-skeleton";
import { ReportableHeading } from "@/components/reportable-heading";
import { DocentSection } from "@/components/scan/result/docent-section";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import type { SavedWork } from "@/db/schema";
import { useScan } from "@/lib/result/use-scan";
import type { ContentReportTarget } from "@/lib/social/report";
import { useArtworkEnrichment } from "@/lib/use-artwork-enrichment";
import { useArtworkResearch } from "@/lib/use-artwork-research";

import type { Id } from "../../../convex/_generated/dataModel";

export function ArtworkEnrichment({ artworkId }: { artworkId: Id<"artworks"> }) {
  const enrichment = useArtworkEnrichment(artworkId);
  const research = useArtworkResearch(artworkId);
  if (!enrichment) return null;
  if (enrichment instanceof Error) {
    return (
      <Section title="About this work">
        <ThemedText themeColor="textSecondary">Details about this work are unavailable right now.</ThemedText>
      </Section>
    );
  }

  const { docent, factSheet, narration, narrationFacts, narrationWriting } = enrichment;
  return (
    <>
      {(!!docent?.length || research.status) && (
        <Section title="About this work" report={docent?.length ? { kind: "docent", artworkId } : undefined}>
          <DocentSection
            docent={docent}
            factSheet={factSheet}
            status={research.status}
            onRetry={research.retry}
            waitWhileWriting
          />
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

/** The private description written for a scan's confirmed details; only the scan's own device can read it. */
export function ScanEnrichment({
  scanId,
  work,
}: {
  scanId: Id<"scans">;
  work: Pick<SavedWork, "title" | "artist" | "date">;
}) {
  const scan = useScan(scanId);
  if (!scan || scan instanceof Error || !scan.confirmed) return null;
  const confirmed = scan.confirmed.fields;
  if (
    (["title", "artist", "date"] as const).some(
      (field) => (work[field]?.trim() ?? "") !== (confirmed[field]?.trim() ?? ""),
    )
  ) {
    return null;
  }
  const writing = scan.docentStatus === "writing";
  if (!scan.docent?.length && !writing) return null;
  return (
    <Section title="About this work" report={scan.docent?.length ? { kind: "scanDocent", scanId } : undefined}>
      <DocentSection docent={scan.docent} factSheet={scan.factSheet} status={writing ? "writing" : undefined} />
    </Section>
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
