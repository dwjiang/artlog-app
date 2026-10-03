import { Color, Link, type LinkMenuActionProps, router } from "expo-router";
import type { ReactNode } from "react";
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
/** The bar's tappable summary: a tap opens the player, a long press offers listening actions without opening it. */
export function PlayerSummary({
  audio,
  accessibilityLabel,
  accessibilityValue,
  children,
}: {
  audio: Listening;
  accessibilityLabel: string;
  accessibilityValue?: { text: string };
  children: ReactNode;
}) {
  const queueActions: { name: string; label: string; icon: LinkMenuActionProps["icon"]; run: () => void }[] = [
    { name: "upNext", label: "Up next", icon: "list.bullet", run: () => openPlayer("queue") },
    { name: "restart", label: "Restart narration", icon: "arrow.counterclockwise", run: audio.controller.restart },
  ];
  const stop = { name: "stop", label: "Stop listening", run: audio.controller.stop };
  const actions = [...queueActions, stop];
  return (
    <Link href={{ pathname: "/now-playing", params: { view: "player" } }} push asChild>
      <Link.Trigger>
        <Pressable
          // Link hands its child role="link"; the summary opens a sheet, so it stays a button.
          role="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={accessibilityValue}
          accessibilityActions={actions.map(({ name, label }) => ({ name, label }))}
          onAccessibilityAction={({ nativeEvent }) =>
            actions.find((action) => action.name === nativeEvent.actionName)?.run()
          }
          style={accessoryStyles.summary}
        >
          {children}
        </Pressable>
      </Link.Trigger>
      <Link.Menu>
        {queueActions.map((action) => (
          <Link.MenuAction key={action.name} icon={action.icon} onPress={action.run}>
            {action.label}
          </Link.MenuAction>
        ))}
        <Link.Menu inline>
          <Link.MenuAction icon="stop" destructive onPress={stop.run}>
            {stop.label}
          </Link.MenuAction>
        </Link.Menu>
      </Link.Menu>
    </Link>
  );
}
export function MiniPlayer() {
  const audio = useListening();
  if (!audio.current) return null;
  const subtitle = narrationStatus(audio);
  return (
    <View style={accessoryStyles.row}>
      <PlayerSummary audio={audio} accessibilityLabel={`Open player, ${audio.current.work.title}, ${subtitle}`}>
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
      </PlayerSummary>
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
