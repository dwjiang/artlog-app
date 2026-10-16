import { type RefObject, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ParagraphSkeleton } from "@/components/loading-skeleton";
import { MotionPressable } from "@/components/motion-pressable";
import { ReportableHeading } from "@/components/reportable-heading";
import { citeDocent, citedLabel, SourceMarkers } from "@/components/scan/result/docent-section";
import { SourceList } from "@/components/scan/result/source-list";
import { ThemedText as Text } from "@/components/themed-text";
import { Fonts, Gallery, Radius, Spacing } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { GUIDE_SECTION_TITLES, guideTimeline, sentenceAt } from "@/lib/audio/guide-timeline";
import { canSeekTo } from "@/lib/audio/listening-controller";
import { trackKey, type ListeningTrack } from "@/lib/audio/narration";
import { preparationLabel } from "@/lib/audio/narration-preparation";
import { useListening } from "@/lib/audio/use-listening";

import type { GuideSentence } from "../../../convex/lib/validators";
import { ArtworkThumbnail } from "./artwork-thumbnail";
import { AudioIcon } from "./audio-icon";

export const TRANSCRIPT_PENDING = "The transcript will appear when your audio guide is ready.";
// The spoken sentence settles a quarter of the way down, leaving what was just said in view above it.
const READING_LINE = 0.25;

/** The spoken script, following the voice: the sentence being spoken is highlighted and kept in view. */
export function GuideFollowAlong() {
  const audio = useListening();
  if (!audio.current) return null;
  const { work } = audio.current;
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <ReportableHeading report={{ kind: "transcript", artworkId: work.artworkId }} disabled={!audio.sentences}>
          <View style={styles.heading}>
            <ArtworkThumbnail uri={work.imageUri} size={52} />
            <View style={styles.headingText}>
              <Text style={styles.title} numberOfLines={2}>
                {work.title}
              </Text>
              <Text variant="secondary" themeColor="textSecondary" numberOfLines={1}>
                {[work.artist, work.date].filter(Boolean).join(" · ")}
              </Text>
            </View>
          </View>
        </ReportableHeading>
      </View>
      {audio.sentences ? (
        // A new work or render starts at its own first sentence.
        <Script
          key={`${trackKey(audio.current)}:${audio.renderId}`}
          track={audio.current}
          sentences={audio.sentences}
        />
      ) : audio.phase === "loading" ? (
        <View style={styles.pending}>
          <ParagraphSkeleton label={preparationLabel(audio.preparationStage)} />
        </View>
      ) : (
        <Text themeColor="textSecondary" style={styles.pending}>
          {TRANSCRIPT_PENDING}
        </Text>
      )}
    </View>
  );
}

function Script({ track, sentences }: { track: ListeningTrack; sentences: GuideSentence[] }) {
  const audio = useListening();
  const reduced = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const offsets = useRef<number[]>([]);
  const placed = useRef(false);
  const scrolled = useRef(0);
  const [viewport, setViewport] = useState(0);
  const [following, setFollowing] = useState(true);
  const [currentAbove, setCurrentAbove] = useState(false);
  const timeline = guideTimeline(sentences, audio.duration);
  const current = sentenceAt(timeline, audio.position);
  const cited = citeDocent(sentences, track.work.facts);

  // Keeps the spoken sentence in view until the listener scrolls away to read on their own; the first
  // placement jumps, so opening the transcript mid-guide lands on the spoken sentence.
  useEffect(() => {
    if (following) placed.current = reveal(scroll, offsets.current[current], viewport, placed.current && !reduced);
  }, [current, following, viewport, reduced]);

  function playFrom(index: number) {
    setFollowing(true);
    void audio.controller.seek(timeline.starts[index], { play: true, clamp: false });
  }
  function settle() {
    const offset = offsets.current[current];
    if (offset !== undefined) setCurrentAbove(offset < scrolled.current);
  }

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scroll}
        testID="guide-script"
        style={styles.root}
        contentContainerStyle={styles.script}
        onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
        onScroll={(event) => {
          scrolled.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={100}
        onScrollBeginDrag={() => setFollowing(false)}
        onScrollEndDrag={settle}
        onMomentumScrollEnd={settle}
      >
        {sentences.map(({ section }, index) => {
          const { sentence, markers } = cited.sentences[index];
          const spoken = index === current;
          const seekable = canSeekTo(audio, timeline.starts[index]);
          return (
            // Measured as direct children of the script, so a section's title stays in view with its first sentence.
            <View
              key={index}
              onLayout={(event) => {
                offsets.current[index] = event.nativeEvent.layout.y;
                if (index === current && following && !placed.current) {
                  placed.current = reveal(scroll, offsets.current[index], viewport, false);
                }
              }}
            >
              {section !== sentences[index - 1]?.section && (
                <Text
                  variant="eyebrow"
                  themeColor="textSecondary"
                  accessibilityRole="header"
                  style={[styles.section, index === 0 && styles.firstSection]}
                >
                  {GUIDE_SECTION_TITLES[section]}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={citedLabel(sentence, markers, cited.sources)}
                accessibilityHint="Plays the guide from this sentence."
                accessibilityState={{ selected: spoken, disabled: !seekable }}
                disabled={!seekable}
                onPress={() => playFrom(index)}
                style={({ pressed }) => [styles.line, spoken ? styles.spoken : pressed && styles.pressed]}
              >
                <Text style={[styles.sentence, spoken && styles.spokenText]}>
                  <Text style={[styles.sentence, spoken && styles.spokenText]}>{sentence}</Text>
                  <SourceMarkers markers={markers} />
                </Text>
              </Pressable>
            </View>
          );
        })}
        <View style={styles.sources}>
          <SourceList sources={cited.sources} />
        </View>
      </ScrollView>
      {!following && (
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel="Back to current line"
          onPress={() => setFollowing(true)}
          style={styles.backToNow}
        >
          <AudioIcon name={currentAbove ? "arrow.up" : "arrow.down"} size={14} color={Gallery.accent} />
          <Text variant="button" style={styles.backToNowLabel}>
            Back to current line
          </Text>
        </MotionPressable>
      )}
    </View>
  );
}

function reveal(scroll: RefObject<ScrollView | null>, offset: number | undefined, viewport: number, animated: boolean) {
  if (offset === undefined || !viewport || !scroll.current) return false;
  scroll.current.scrollTo({ y: Math.max(0, offset - viewport * READING_LINE), animated });
  return true;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: Spacing.content, paddingBottom: Spacing.two },
  heading: { flexDirection: "row", alignItems: "center", gap: Spacing.compact, flexShrink: 1 },
  headingText: { flexShrink: 1, gap: 2 },
  title: { fontFamily: Fonts.display, fontSize: 19, lineHeight: 24, letterSpacing: -0.3, color: Gallery.ink },
  pending: { paddingHorizontal: Spacing.content, paddingTop: Spacing.four },
  script: { paddingHorizontal: Spacing.content, paddingBottom: Spacing.six },
  section: { marginTop: Spacing.four, marginBottom: Spacing.one },
  firstSection: { marginTop: Spacing.three },
  line: {
    marginHorizontal: -Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    marginBottom: Spacing.two,
    borderRadius: Radius.button,
  },
  spoken: { backgroundColor: Gallery.highlight },
  pressed: { backgroundColor: Gallery.fill },
  sentence: { fontSize: 20, lineHeight: 28, color: Gallery.muted },
  spokenText: { color: Gallery.ink },
  sources: { paddingTop: Spacing.three },
  backToNow: {
    position: "absolute",
    alignSelf: "center",
    bottom: Spacing.compact,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.full,
    backgroundColor: Gallery.surface,
    boxShadow: "0 4px 16px rgba(27,37,49,0.16)",
  },
  backToNowLabel: { color: Gallery.accent },
});
