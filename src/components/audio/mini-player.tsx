import { Color, router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { audioTime } from "@/lib/audio/narration";
import { preparationLabel } from "@/lib/audio/narration-preparation";
import { useListening } from "@/lib/audio/use-listening";

import { ArtworkThumbnail } from "./artwork-thumbnail";
import { AudioIconButton } from "./audio-icon";

export const MINI_PLAYER_HEIGHT = 48;
export function openPlayer(view: "player" | "queue" = "player") {
  router.push({ pathname: "/now-playing", params: { view } });
}
type Listening = ReturnType<typeof useListening>;
export function narrationStatus(audio: Listening) {
  if (audio.phase === "loading") return preparationLabel(audio.preparationStage);
  if (audio.phase === "error") return "Couldn’t play · Tap to retry";
  if (audio.waiting) return "Ready to play";
  return `${audio.playing ? "Playing" : "Paused"}${audio.duration ? ` · ${audioTime(audio.duration - audio.position)} left` : ""}`;
}
export function NarrationToggle({ audio, status }: { audio: Listening; status: string }) {
  return audio.phase === "loading" ? (
    <LoadingRing accessibilityLabel={status} size={22} style={{ minWidth: 44, minHeight: 44 }} />
  ) : (
    <AudioIconButton
      name={audio.playing ? "pause.fill" : "play.fill"}
      label={audio.phase === "error" ? "Retry narration" : audio.playing ? "Pause narration" : "Play narration"}
      onPress={audio.controller.toggle}
      color={Gallery.accent}
      size={23}
    />
  );
}
export function MiniPlayer() {
  const audio = useListening();
  if (!audio.current) return null;
  const subtitle = narrationStatus(audio);
  return (
    <View style={accessoryStyles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open player, ${audio.current.work.title}, ${subtitle}`}
        onPress={() => openPlayer()}
        style={accessoryStyles.summary}
      >
        <ArtworkThumbnail uri={audio.current.work.imageUri} size={32} />
        <View style={{ flex: 1, gap: 2 }}>
          {/* Native colors follow the glass accessory's contrast, even while the app stays in light mode. */}
          <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "600", color: Color.ios.label }}>
            {audio.current.work.title}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontSize: 11, color: Color.ios.secondaryLabel, fontVariant: ["tabular-nums"] }}
          >
            {subtitle}
          </Text>
        </View>
      </Pressable>
      <NarrationToggle audio={audio} status={subtitle} />
      <AudioIconButton
        name="list.bullet"
        label="Up next"
        onPress={() => openPlayer("queue")}
        color={Color.ios.label}
        size={22}
      />
    </View>
  );
}
/** The row both accessory bars share: a tappable summary that opens the player, then trailing controls. */
export const accessoryStyles = StyleSheet.create({
  row: {
    minHeight: MINI_PLAYER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    paddingRight: 4,
  },
  summary: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});
