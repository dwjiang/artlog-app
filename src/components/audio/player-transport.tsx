import { Host, Icon, Row, Text as NativeText } from "@expo/ui";
import { Group } from "@expo/ui/swift-ui";
import { contentShape, font, frame, menuOrder, shapes } from "@expo/ui/swift-ui/modifiers";
import Slider from "@react-native-community/slider";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View, useWindowDimensions } from "react-native";

import { NativeChoiceMenu } from "@/components/choice-menu";
import { LoadingRing } from "@/components/loading-ring";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { type GuideTimeline, guideTimeline, sentenceAt } from "@/lib/audio/guide-timeline";
import { canSeekTo, type ListeningState } from "@/lib/audio/listening-controller";
import { audioTime } from "@/lib/audio/narration";
import { preparationLabel } from "@/lib/audio/narration-preparation";
import { useListening } from "@/lib/audio/use-listening";

import type { GuideSection } from "../../../convex/lib/validators";
import { SystemVolumeSlider } from "../../../modules/system-volume/src";
import { AudioIcon, AudioIconButton } from "./audio-icon";

export type PlayerView = "player" | "queue" | "transcript" | "saved";
export function PlayerTransport({ view, onView }: { view: PlayerView; onView: (view: PlayerView) => void }) {
  const audio = useListening();
  const [scrubbing, setScrubbing] = useState(false);
  const dragging = useRef(false);
  const [draft, setDraft] = useState(audio.position);
  const [draftScale, setDraftScale] = useState(0);
  const ready = audio.phase === "ready";
  const preparing = audio.phase === "loading";
  const preparation = preparationLabel(audio.preparationStage);
  useEffect(() => {
    if (preparing) AccessibilityInfo.announceForAccessibility(preparation);
  }, [preparing, preparation]);
  const availableDuration = audio.duration || audio.availableDuration;
  const seekable = ready && availableDuration > 0;
  const timeline = audio.sentences ? guideTimeline(audio.sentences, audio.duration) : undefined;
  // The bar spans the whole guide; while a live guide's length is unknown, that is the estimate, beyond what is generated.
  const scale = Math.max(timeline?.length ?? 0, availableDuration);
  const sliderScale = scrubbing ? draftScale : scale;
  const position = scrubbing ? draft : audio.position;
  const queue = view === "queue" || view === "saved";
  const section = timeline && sectionAt(timeline, position);
  return (
    <View style={styles.container}>
      <View style={styles.status}>
        {preparing ? (
          <Text variant="secondary" themeColor="textSecondary">
            {preparation}
          </Text>
        ) : (
          timeline
          && section && (
            <SectionMenu
              timeline={timeline}
              current={section}
              audio={audio}
              onSelect={(start) => void audio.controller.seek(start, { clamp: false })}
            />
          )
        )}
        {audio.waiting && ready && (
          <Text variant="secondary" themeColor="textSecondary">
            Ready to play
          </Text>
        )}
      </View>
      <View style={styles.scrubber}>
        <SectionTrack
          timeline={timeline}
          scale={sliderScale}
          position={seekable ? position : 0}
          available={audio.duration ? 0 : audio.availableDuration}
        />
        <Slider
          accessibilityRole="adjustable"
          accessibilityLabel="Narration position"
          accessibilityValue={{
            text: seekable
              ? `${audioTime(position)} of ${audioTime(availableDuration)}${audio.duration ? "" : " available"}`
              : audioTime(position),
          }}
          accessibilityActions={[
            { name: "increment", label: "Forward 15 seconds" },
            { name: "decrement", label: "Back 15 seconds" },
          ]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (seekable) {
              void audio.controller.seek(audio.position + (nativeEvent.actionName === "increment" ? 15 : -15));
            }
          }}
          value={seekable ? position : 0}
          minimumValue={0}
          maximumValue={Math.max(1, sliderScale)}
          disabled={!seekable}
          tapToSeek
          thumbSize={1}
          thumbTintColor="transparent"
          minimumTrackTintColor="transparent"
          maximumTrackTintColor="transparent"
          style={styles.slider}
          onSlidingStart={(value) => {
            dragging.current = true;
            setDraft(value);
            setDraftScale(scale);
            setScrubbing(true);
          }}
          onValueChange={(value) => {
            setDraft(value);
            if (!dragging.current) void audio.controller.seek(value);
          }}
          onSlidingComplete={(value) => {
            dragging.current = false;
            setScrubbing(false);
            void audio.controller.seek(value);
          }}
        />
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{preparing ? "—:—" : audioTime(position)}</Text>
        {seekable && (
          <Text style={styles.time}>
            {audio.duration ? `−${audioTime(audio.duration - position)}` : `${audioTime(availableDuration)} available`}
          </Text>
        )}
      </View>
      <View style={styles.controls}>
        <AudioIconButton
          name="gobackward.15"
          label="Back 15 seconds"
          size={29}
          disabled={!seekable}
          onPress={() => void audio.controller.seek(audio.position - 15)}
        />
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel={
            preparing
              ? preparation
              : audio.phase === "error"
                ? "Retry narration"
                : audio.playing
                  ? "Pause narration"
                  : "Play narration"
          }
          accessibilityState={{ busy: preparing, disabled: preparing }}
          disabled={preparing}
          onPress={audio.controller.toggle}
          style={styles.play}
        >
          {preparing ? (
            <LoadingRing color={Gallery.surface} size={36} accessible={false} />
          ) : (
            <AudioIcon
              name={audio.phase === "error" ? "arrow.clockwise" : audio.playing ? "pause.fill" : "play.fill"}
              size={32}
              color={Gallery.surface}
            />
          )}
        </MotionPressable>
        <AudioIconButton
          name="goforward.15"
          label="Forward 15 seconds"
          size={29}
          disabled={!seekable}
          onPress={() => void audio.controller.seek(audio.position + 15)}
        />
      </View>
      <View style={styles.volume}>
        <AudioIcon name="speaker.fill" size={12} color={Gallery.muted} />
        <SystemVolumeSlider
          minimumTrackColor={Gallery.muted}
          maximumTrackColor={Gallery.softBorder}
          style={[styles.slider, { flex: 1 }]}
        />
        <AudioIcon name="speaker.wave.2.fill" size={16} color={Gallery.muted} />
      </View>
      <View style={styles.actions}>
        <TransportAction
          label="Speed"
          accessibilityLabel={`Playback speed, ${audio.rate} times`}
          onPress={() => {
            const rates = [1, 1.25, 1.5, 2];
            audio.controller.setRate(rates[(rates.indexOf(audio.rate) + 1) % rates.length]);
          }}
        >
          <Text style={styles.rate}>{audio.rate}×</Text>
        </TransportAction>
        <TransportAction
          label="Transcript"
          accessibilityLabel="Transcript and sources"
          selected={view === "transcript"}
          onPress={() => onView(view === "transcript" ? "player" : "transcript")}
        >
          <View style={styles.tailedIcon}>
            <AudioIcon name="captions.bubble" size={21} color={view === "transcript" ? Gallery.accent : Gallery.ink} />
          </View>
        </TransportAction>
        <TransportAction label="Up next" selected={queue} onPress={() => onView(queue ? "player" : "queue")}>
          <AudioIcon name="list.bullet" size={20} color={queue ? Gallery.accent : Gallery.ink} />
        </TransportAction>
      </View>
    </View>
  );
}

function sectionAt(timeline: GuideTimeline, position: number) {
  const sentence = sentenceAt(timeline, position);
  return timeline.sections.findLast((section) => section.sentence <= sentence)?.section;
}

/** The current part of the guide as a native pop-up button that jumps to the start of another part. */
function SectionMenu({
  timeline,
  current,
  audio,
  onSelect,
}: {
  timeline: GuideTimeline;
  current: GuideSection;
  audio: ListeningState;
  onSelect: (start: number) => void;
}) {
  const { fontScale } = useWindowDimensions();
  const { sections } = timeline;
  return (
    <Host matchContents colorScheme="light">
      {/* The menu opens upward; a fixed order still lists the sections in the order they are spoken. */}
      <Group modifiers={[menuOrder("fixed")]}>
        <NativeChoiceMenu
          label="Section"
          value={current}
          disabled={!canSeekTo(audio, 0)}
          options={sections.map(({ section, title, start }) => ({
            value: section,
            label: title,
            disabled: !canSeekTo(audio, start),
          }))}
          onChange={(chosen) => {
            const start = sections.find(({ section }) => section === chosen)?.start;
            if (start !== undefined) onSelect(start);
          }}
        >
          <Row spacing={5} alignment="center" modifiers={[frame({ minHeight: 44 }), contentShape(shapes.rectangle())]}>
            <NativeText
              textStyle={{ color: Gallery.ink }}
              modifiers={[font({ textStyle: "subheadline", weight: "semibold" })]}
            >
              {sections.find(({ section }) => section === current)?.title}
            </NativeText>
            <Icon name="chevron.up.chevron.down" size={11 * fontScale} color={Gallery.muted} />
          </Row>
        </NativeChoiceMenu>
      </Group>
    </Host>
  );
}

/** The progress bar under the transparent slider, split into the guide's sections. */
function SectionTrack({
  timeline,
  scale,
  position,
  available,
}: {
  timeline?: GuideTimeline;
  scale: number;
  position: number;
  available: number;
}) {
  const parts =
    timeline?.sections.length && scale > 0
      ? timeline.sections.map(({ start, end }, index, all) => ({ start, end: index === all.length - 1 ? scale : end }))
      : [{ start: 0, end: Math.max(scale, 1) }];
  const share = (value: number, start: number, end: number): `${number}%` =>
    `${end > start ? Math.min(100, Math.max(0, ((value - start) / (end - start)) * 100)) : 0}%`;
  return (
    <View style={styles.track} pointerEvents="none">
      {parts.map(({ start, end }) => (
        <View key={start} style={[styles.part, { flex: Math.max(end - start, 0.001) }]}>
          {available > 0 && <View style={[styles.generated, { width: share(available, start, end) }]} />}
          <View style={[styles.elapsed, { width: share(position, start, end) }]} />
        </View>
      ))}
    </View>
  );
}

function TransportAction({
  label,
  accessibilityLabel = label,
  selected,
  onPress,
  children,
}: {
  label: string;
  accessibilityLabel?: string;
  selected?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.actionSlot}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected }}
        onPress={onPress}
        style={[styles.action, selected && styles.selected]}
      >
        <View style={styles.actionIcon}>{children}</View>
        <Text
          variant="metadata"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[styles.actionLabel, selected && styles.selectedLabel]}
        >
          {label}
        </Text>
      </MotionPressable>
    </View>
  );
}
const TRACK_HEIGHT = 5;
const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.content,
    backgroundColor: Gallery.paper,
  },
  status: {
    minHeight: 32,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: Spacing.compact,
  },
  // The slider's own padding already spaces the bar from the section name above it.
  scrubber: { justifyContent: "center", marginTop: -Spacing.two },
  slider: { height: 44 },
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    height: TRACK_HEIGHT,
    flexDirection: "row",
    gap: 3,
  },
  part: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    overflow: "hidden",
    backgroundColor: Gallery.softBorder,
  },
  generated: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: Gallery.accentBorder },
  elapsed: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: Gallery.accent },
  times: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -8,
  },
  time: {
    fontSize: 12,
    lineHeight: 18,
    fontVariant: ["tabular-nums"],
    color: Gallery.muted,
  },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 48,
    alignItems: "center",
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  play: {
    width: 76,
    height: 76,
    borderRadius: Radius.full,
    backgroundColor: Gallery.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  volume: { flexDirection: "row", alignItems: "center", gap: Spacing.compact },
  // Bottom-aligned, the labels stay level when the speed figure grows with Dynamic Type and the icons do not.
  actions: { flexDirection: "row", alignItems: "flex-end", marginHorizontal: -Spacing.two },
  actionSlot: { flex: 1, alignItems: "center" },
  action: {
    minWidth: 88,
    maxWidth: "100%",
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: Spacing.compact,
    paddingVertical: Spacing.one,
    borderRadius: Radius.card,
  },
  actionIcon: { minHeight: 24, alignItems: "center", justifyContent: "center" },
  selected: { backgroundColor: Gallery.highlight },
  actionLabel: { color: Gallery.ink, fontWeight: "500" },
  selectedLabel: { color: Gallery.accent, fontWeight: "600" },
  // Centering the whole bubble leaves its body above the label; drop it by half the tail, like a descender.
  tailedIcon: { transform: [{ translateY: 1.5 }] },
  rate: { color: Gallery.ink, fontSize: 17, lineHeight: 22, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
