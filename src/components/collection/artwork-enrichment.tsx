import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { DocentSection } from "@/components/scan/result/docent-section";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
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

  const { docent, factSheet, narration, narrationFacts } = enrichment;
  return (
    <>
      {!!docent?.length && (
        <Section title="About this work">
          <DocentSection docent={docent} factSheet={factSheet} />
        </Section>
      )}
      {!!narration?.length && (
        <Section title="Audio guide transcript">
          <DocentSection docent={narration} factSheet={narrationFacts} />
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText variant="section">{title}</ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
