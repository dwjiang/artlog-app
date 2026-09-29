import Slider from "@react-native-community/slider";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { audioTime } from "@/lib/audio/narration";
import { preparationLabel } from "@/lib/audio/narration-preparation";
import { useListening } from "@/lib/audio/use-listening";

import { SystemVolumeSlider } from "../../../modules/system-volume/src";
import { AudioIcon, AudioIconButton } from "./audio-icon";

export type PlayerView = "player" | "queue" | "transcript" | "saved";
// With Transcript centered, a row needs two Speed columns ("1.25×" and "Speed", 82 pt at the 14 pt label size) around a
// selected "Transcript" (69 pt), plus 132 pt of gutters, icons, and padding that don't scale; below that labels shrink.
export function transportStacks(width: number, fontScale: number) {
  return width < 132 + (2 * 82 + 69) * fontScale;
}
export function PlayerTransport({ view, onView }: { view: PlayerView; onView: (view: PlayerView) => void }) {
  const audio = useListening();
  const { width, fontScale } = useWindowDimensions();
  const [scrubbing, setScrubbing] = useState(false);
  const dragging = useRef(false);
  const [draft, setDraft] = useState(audio.position);
  const ready = audio.phase === "ready";
  const preparing = audio.phase === "loading";
  const preparation = preparationLabel(audio.preparationStage);
  useEffect(() => {
    if (preparing) AccessibilityInfo.announceForAccessibility(preparation);
  }, [preparing, preparation]);
  // Speech still being generated has no length yet, so there is no range to seek within.
  const seekable = ready && audio.duration > 0;
  const position = scrubbing ? draft : audio.position;
  const queue = view === "queue" || view === "saved";
  const stacked = transportStacks(width, fontScale);
  return (
    <View style={styles.container}>
      <Slider
        accessibilityRole="adjustable"
        accessibilityLabel="Narration position"
        accessibilityValue={{
          text: seekable ? `${audioTime(position)} of ${audioTime(audio.duration)}` : audioTime(position),
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
        value={seekable ? audio.position : 0}
        minimumValue={0}
        maximumValue={Math.max(1, audio.duration)}
        disabled={!seekable}
        tapToSeek
        thumbSize={1}
        thumbTintColor="transparent"
        minimumTrackTintColor={Gallery.accent}
        maximumTrackTintColor={Gallery.softBorder}
        style={styles.slider}
        onSlidingStart={(value) => {
          dragging.current = true;
          setDraft(value);
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
      <View style={styles.times}>
        <Text style={styles.time}>{preparing ? "—:—" : audioTime(position)}</Text>
        {seekable && <Text style={styles.time}>−{audioTime(audio.duration - position)}</Text>}
      </View>
      <View style={styles.controls}>
        <AudioIconButton
          name="gobackward.15"
          label="Back 15 seconds"
          size={29}
          disabled={!seekable}
          onPress={() => void audio.controller.seek(audio.position - 15)}
        />
        <Pressable
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
          style={({ pressed }) => [styles.play, { opacity: pressed ? 0.75 : 1 }]}
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
        </Pressable>
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
      <View style={[styles.bottom, stacked && styles.stacked]}>
        <View style={!stacked && styles.leading}>
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
        </View>
        <TransportAction
          label="Transcript"
          accessibilityLabel="Transcript and sources"
          selected={view === "transcript"}
          onPress={() => onView(view === "transcript" ? "player" : "transcript")}
        >
          <View style={styles.tailedIcon}>
            <AudioIcon name="captions.bubble" size={20} />
          </View>
        </TransportAction>
        <View style={!stacked && styles.trailing}>
          <TransportAction label="Up next" selected={queue} onPress={() => onView(queue ? "player" : "queue")}>
            <AudioIcon name="list.bullet" size={20} />
          </TransportAction>
        </View>
      </View>
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.action, selected && styles.selected, { opacity: pressed ? 0.6 : 1 }]}
    >
      {children}
      <Text
        variant="secondary"
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.actionLabel, selected && styles.selectedLabel]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.content,
    backgroundColor: Gallery.paper,
  },
  slider: { height: 44 },
  times: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -4,
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
    marginTop: Spacing.compact,
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
  bottom: { flexDirection: "row", alignItems: "center", gap: Spacing.two, marginHorizontal: -Spacing.two },
  stacked: { flexDirection: "column", alignItems: "stretch" },
  // Equal side columns keep Transcript centered under Play whatever the speed label's width.
  leading: { flex: 1, alignItems: "flex-start" },
  trailing: { flex: 1, alignItems: "flex-end" },
  action: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.button,
  },
  selected: { backgroundColor: Gallery.highlight },
  actionLabel: { flexShrink: 1, color: Gallery.ink },
  selectedLabel: { fontWeight: "600" },
  // Centering the whole bubble leaves its body above the label; drop it by half the tail, like a descender.
  tailedIcon: { transform: [{ translateY: 1.5 }] },
  rate: { color: Gallery.ink, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
