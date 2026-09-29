import Slider from "@react-native-community/slider";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { audioTime } from "@/lib/audio/narration";
import { preparationLabel } from "@/lib/audio/narration-preparation";
import { useListening } from "@/lib/audio/use-listening";

import { SystemVolumeSlider } from "../../../modules/system-volume/src";
import { AudioIcon, AudioIconButton } from "./audio-icon";
import { NarrationWaveform } from "./narration-waveform";

export type PlayerView = "player" | "queue" | "transcript" | "saved";
export function PlayerTransport({ view, onView }: { view: PlayerView; onView: (view: PlayerView) => void }) {
  const audio = useListening();
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
            <NarrationWaveform color={Gallery.surface} size={40} />
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
      <View style={styles.bottom}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Playback speed, ${audio.rate} times`}
          onPress={() => {
            const rates = [1, 1.25, 1.5, 2];
            audio.controller.setRate(rates[(rates.indexOf(audio.rate) + 1) % rates.length]);
          }}
          style={styles.action}
        >
          <Text
            style={{
              color: Gallery.ink,
              fontSize: 14,
              fontWeight: "600",
              fontVariant: ["tabular-nums"],
            }}
          >
            {audio.rate}×
          </Text>
        </Pressable>
        <AudioIconButton
          name="captions.bubble"
          label="Transcript and sources"
          selected={view === "transcript"}
          onPress={() => onView(view === "transcript" ? "player" : "transcript")}
          style={view === "transcript" && styles.selected}
        />
        <AudioIconButton
          name="list.bullet"
          label="Up next"
          selected={queue}
          onPress={() => onView(queue ? "player" : "queue")}
          style={queue && styles.selected}
        />
      </View>
    </View>
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
  bottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  action: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  selected: { backgroundColor: Gallery.highlight, borderRadius: Radius.button },
});
