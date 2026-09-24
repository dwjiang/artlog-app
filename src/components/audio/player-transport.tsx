import Slider from "@react-native-community/slider";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { audioTime } from "@/lib/audio/narration";
import { useListening } from "@/lib/audio/use-listening";

import { SystemVolumeSlider } from "../../../modules/system-volume/src";
import { AudioIcon, AudioIconButton } from "./audio-icon";

export type PlayerView = "player" | "queue" | "transcript" | "saved";
export function PlayerTransport({ view, onView }: { view: PlayerView; onView: (view: PlayerView) => void }) {
  const audio = useListening();
  const { fontScale } = useWindowDimensions();
  const [scrubbing, setScrubbing] = useState(false);
  const dragging = useRef(false);
  const [draft, setDraft] = useState(audio.position);
  const ready = audio.phase === "ready";
  const position = scrubbing ? draft : audio.position;
  return (
    <View style={styles.container}>
      <Slider
        accessibilityRole="adjustable"
        accessibilityLabel="Narration position"
        accessibilityValue={{
          text: `${audioTime(position)} of ${audioTime(audio.duration)}`,
        }}
        accessibilityActions={[
          { name: "increment", label: "Forward 15 seconds" },
          { name: "decrement", label: "Back 15 seconds" },
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (ready) {
            void audio.controller.seek(audio.position + (nativeEvent.actionName === "increment" ? 15 : -15));
          }
        }}
        value={audio.position}
        minimumValue={0}
        maximumValue={Math.max(1, audio.duration)}
        disabled={!ready}
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
        <Text style={styles.time}>{audioTime(position)}</Text>
        <Text style={styles.time}>−{audioTime(audio.duration - position)}</Text>
      </View>
      <View style={styles.controls}>
        <AudioIconButton
          name="gobackward.15"
          label="Back 15 seconds"
          size={29}
          disabled={!ready}
          onPress={() => void audio.controller.seek(audio.position - 15)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            audio.phase === "loading"
              ? "Preparing narration"
              : audio.phase === "error"
                ? "Retry narration"
                : audio.playing
                  ? "Pause narration"
                  : "Play narration"
          }
          accessibilityState={{
            busy: audio.phase === "loading",
            disabled: audio.phase === "loading",
          }}
          disabled={audio.phase === "loading"}
          onPress={audio.controller.toggle}
          style={({ pressed }) => [styles.play, { opacity: pressed ? 0.75 : 1 }]}
        >
          {audio.phase === "loading" ? (
            <LoadingRing color={Gallery.surface} />
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
          disabled={!ready}
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
      <View style={[styles.bottom, fontScale > 1.4 && styles.stacked]}>
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Transcript and sources"
          accessibilityState={{ selected: view === "transcript" }}
          onPress={() => onView(view === "transcript" ? "player" : "transcript")}
          style={[styles.action, view === "transcript" && styles.selected]}
        >
          <AudioIcon name="text.alignleft" size={18} />
          <Text style={[styles.actionText, view === "transcript" && styles.selectedText]}>Transcript</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Up next"
          accessibilityState={{
            selected: view === "queue" || view === "saved",
          }}
          onPress={() => onView(view === "queue" || view === "saved" ? "player" : "queue")}
          style={[styles.action, (view === "queue" || view === "saved") && styles.selected]}
        >
          <AudioIcon name="list.bullet" size={20} />
          <Text style={[styles.actionText, (view === "queue" || view === "saved") && styles.selectedText]}>
            Up next
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.content,
    paddingBottom: Spacing.two,
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
  bottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.one,
    marginTop: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Gallery.softBorder,
  },
  stacked: { flexWrap: "wrap", justifyContent: "center" },
  action: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.compact,
    borderRadius: Radius.button,
  },
  selected: { backgroundColor: Gallery.highlight },
  selectedText: { fontWeight: "600" },
  actionText: { fontSize: 12, lineHeight: 18, color: Gallery.ink },
});
