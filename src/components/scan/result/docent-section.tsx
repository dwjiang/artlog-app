import { Image } from "expo-image";
import { Fragment, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import type {
  DocentSentence,
  FactChip,
} from "../../../../convex/lib/validators";

import { SourceLink } from "./source-chip";
import { ThemedText } from "@/components/themed-text";
import { HighlightHeading } from "@/components/highlight-heading";
import { Gallery, Spacing } from "@/constants/theme";
import { ParagraphSkeleton } from "@/components/loading-skeleton";

/** How long to wait before explaining that background information is unavailable. */
export const DOCENT_WAIT_MS = 10_000;

export type DocentSectionProps = {
  docent?: DocentSentence[];
  factSheet?: FactChip[];
  /** Rendered above the prose only when the section shows anything. */
  title?: string;
  /** True while the backend may still be writing the sentences for this artwork. */
  pending?: boolean;
};

type NumberedSource = { number: number; label: string; url: string };

// Numbers each cited page once, in order of first citation, and marks only the last sentence of
// each run that rests on the same pages, so a single-source paragraph carries one marker.
function citeDocent(docent: DocentSentence[], factSheet: FactChip[] = []) {
  const facts = new Map(factSheet.map((fact) => [fact.id, fact]));
  const sources: NumberedSource[] = [];
  const cited = docent.map(({ sentence, factIds }) => {
    const numbers = new Set<number>();
    for (const factId of factIds) {
      const fact = facts.get(factId);
      if (!fact) continue;
      let source = sources.find(({ url }) => url === fact.sourceUrl);
      if (!source) {
        source = {
          number: sources.length + 1,
          label: fact.sourceLabel,
          url: fact.sourceUrl,
        };
        sources.push(source);
      }
      numbers.add(source.number);
    }
    return { sentence, numbers: [...numbers].sort((a, b) => a - b) };
  });
  const sentences = cited.map(({ sentence, numbers }, index) => ({
    sentence,
    markers: numbers.join() === cited[index + 1]?.numbers.join() ? [] : numbers,
  }));
  return { sentences, sources };
}

/** Cited docent prose: one paragraph with numbered markers, then the numbered sources. */
export function DocentSection({
  docent,
  factSheet,
  title,
  pending = false,
}: DocentSectionProps) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setExpired(true), DOCENT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  const waiting = pending && !expired && !docent?.length;
  if (!docent?.length && !waiting && !title) return null;
  return (
    <View style={styles.section}>
      {title ? <HighlightHeading>{title}</HighlightHeading> : null}
      {waiting ? (
        <ParagraphSkeleton />
      ) : !docent?.length ? (
        <ThemedText themeColor="textSecondary">
          Background information isn’t available for this work yet.
        </ThemedText>
      ) : (
        <CitedParagraph {...citeDocent(docent, factSheet)} />
      )}
    </View>
  );
}

function CitedParagraph({ sentences, sources }: ReturnType<typeof citeDocent>) {
  const labelOf = (number: number) => sources[number - 1].label;
  const spoken = sentences
    .map(({ sentence, markers }) =>
      markers.length
        ? `${sentence} ${markers.length > 1 ? "Sources" : "Source"}: ${markers.map(labelOf).join(", ")}.`
        : sentence,
    )
    .join(" ");
  return (
    <View style={styles.prose}>
      <ThemedText accessibilityLabel={spoken}>
        {sentences.map(({ sentence, markers }, index) => (
          <Fragment key={index}>
            {index > 0 && " "}
            <ThemedText>{sentence}</ThemedText>
            {markers.map((number) => (
              // The paragraph's label speaks the source names, so VoiceOver skips the digits.
              <View
                key={number}
                style={styles.marker}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <SourceNumber number={number} />
              </View>
            ))}
          </Fragment>
        ))}
      </ThemedText>
      {sources.length > 0 && (
        <View style={styles.sources}>
          {sources.map(({ number, label, url }) => (
            <SourceLink key={url} label={label} url={url} style={styles.source}>
              <SourceNumber number={number} />
              <ThemedText type="link" style={styles.sourceLabel}>
                {label}
              </ThemedText>
              <Image
                source="sf:arrow.up.right"
                tintColor={Gallery.accent}
                style={styles.open}
              />
            </SourceLink>
          ))}
        </View>
      )}
    </View>
  );
}

function SourceNumber({ number }: { number: number }) {
  return (
    <View style={styles.number}>
      <ThemedText style={styles.numberText}>{number}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two, paddingTop: Spacing.one },
  prose: { gap: Spacing.two },
  marker: { paddingLeft: 3, transform: [{ translateY: -5 }] },
  number: {
    minWidth: 17,
    minHeight: 17,
    paddingHorizontal: Spacing.one,
    borderRadius: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Gallery.fill,
  },
  numberText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "600",
    color: Gallery.muted,
  },
  sources: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Gallery.separator,
  },
  source: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gallery.separator,
  },
  sourceLabel: { flex: 1 },
  open: { width: 10, height: 10 },
});
