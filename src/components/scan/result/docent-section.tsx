import { Image } from "expo-image";
import { Fragment, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { HighlightHeading } from "@/components/highlight-heading";
import { ParagraphSkeleton } from "@/components/loading-skeleton";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { useScreenActive } from "@/hooks/use-screen-active";
import { isNetworkError } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

import type { DocentSentence, DocentStatus, FactChip } from "../../../../convex/lib/validators";
import { SourceLink } from "./source-chip";

/** How long the card waits on a run before treating it as stalled and offering a retry. */
export const DOCENT_WAIT_MS = 60_000;
export const DOCENT_FAILED = "Couldn’t load background information.";
export const DOCENT_RETRY = "Try again";

export type DocentSectionProps = {
  docent?: DocentSentence[];
  factSheet?: FactChip[];
  /** Rendered above the prose only when the section shows anything. */
  title?: string;
  /** The backend's progress on this artwork's sentences; omitted where nothing is being written. */
  status?: DocentStatus;
  onRetry?: () => Promise<unknown>;
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
export function DocentSection({ docent, factSheet, title, status, onRetry }: DocentSectionProps) {
  // A retry restarts the wait and remounts the failed state, so each attempt gets its own toast.
  const [attempt, setAttempt] = useState(0);
  const [stalled, setStalled] = useState(false);
  const writing = status === "writing";
  useEffect(() => {
    if (!writing) return;
    const timer = setTimeout(() => setStalled(true), DOCENT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [writing, attempt]);
  const retry =
    onRetry
    && (async () => {
      await onRetry();
      setStalled(false);
      setAttempt((current) => current + 1);
    });
  if (!docent?.length && !title && !writing && status !== "failed") return null;
  return (
    <View style={styles.section}>
      {title ? <HighlightHeading>{title}</HighlightHeading> : null}
      {docent?.length ? (
        <CitedParagraph {...citeDocent(docent, factSheet)} />
      ) : status === "failed" || (writing && stalled) ? (
        // One instance for a stall and the server's later failure, so the toast shows once.
        <DocentFailed key={attempt} onRetry={retry} />
      ) : writing ? (
        <ParagraphSkeleton />
      ) : (
        <ThemedText themeColor="textSecondary">Background information isn’t available for this work yet.</ThemedText>
      )}
    </View>
  );
}

function DocentFailed({ onRetry }: { onRetry?: () => Promise<void> }) {
  const active = useScreenActive();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string>();
  const announced = useRef(false);

  async function retry() {
    if (!onRetry) return;
    setRetrying(true);
    setError(undefined);
    try {
      await onRetry();
    } catch (cause) {
      if (!isNetworkError(cause)) reportError(cause, "result.retry_docent");
      setError("Couldn’t reach Artlog. Check your connection and try again.");
      setRetrying(false);
    }
  }

  // One toast per failure, held until the card is on screen so it never lands on another screen.
  useEffect(() => {
    if (!active || announced.current) return;
    announced.current = true;
    showErrorToast(DOCENT_FAILED, onRetry && (() => void retry()));
  });

  return (
    <View style={styles.failed}>
      <ThemedText themeColor="textSecondary">Couldn’t load background information for this work.</ThemedText>
      {onRetry && (
        <GalleryButton
          label={DOCENT_RETRY}
          icon="arrow.clockwise"
          busy={retrying}
          busyLabel="Trying again…"
          disabled={retrying}
          onPress={() => void retry()}
        />
      )}
      {error && (
        <ThemedText themeColor="error" accessibilityRole="alert">
          {error}
        </ThemedText>
      )}
    </View>
  );
}

function CitedParagraph({ sentences, sources }: ReturnType<typeof citeDocent>) {
  const labelOf = (number: number) => sources[number - 1].label;
  const spoken = sentences
    .map(({ sentence, markers }) =>
      markers.length > 0
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
          <ThemedText variant="metadata" themeColor="textSecondary" style={styles.sourcesHeading}>
            Sources
          </ThemedText>
          <View>
            {sources.map(({ number, label, url }) => (
              <SourceLink key={url} label={label} url={url} style={styles.source}>
                <SourceNumber number={number} />
                <ThemedText variant="metadata" style={styles.sourceLabel}>
                  {label}
                </ThemedText>
                <Image source="sf:arrow.up.right" tintColor={Gallery.muted} style={styles.open} />
              </SourceLink>
            ))}
          </View>
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
  failed: { gap: Spacing.one, alignItems: "flex-start" },
  marker: { paddingLeft: Spacing.one },
  number: {
    minWidth: 18,
    minHeight: 18,
    paddingHorizontal: Spacing.one,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Gallery.highlight,
  },
  numberText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    color: Gallery.accent,
  },
  sources: { gap: Spacing.two, paddingTop: Spacing.one },
  sourcesHeading: { fontWeight: "600" },
  source: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: 44,
    paddingVertical: Spacing.two,
  },
  sourceLabel: { flex: 1, fontWeight: "500", color: Gallery.accent },
  open: { width: 10, height: 10 },
});
