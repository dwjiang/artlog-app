import { Color, Link, type LinkMenuActionProps, router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { GUIDE_SECTION_TITLES, guideProgress, sectionAt } from "@/lib/audio/guide-timeline";
import { canSeekTo } from "@/lib/audio/listening-controller";
import { preparationLabel } from "@/lib/audio/narration-preparation";
import { useListening } from "@/lib/audio/use-listening";
import { playLightHaptic } from "@/lib/ui/haptics";

import { ArtworkThumbnail } from "./artwork-thumbnail";
import { AudioIconButton } from "./audio-icon";
import { SectionRing } from "./section-ring";

export const MINI_PLAYER_HEIGHT = 48;
const RING_SIZE = 34;
export function openPlayer(view: "player" | "queue" = "player") {
  router.push({ pathname: "/now-playing", params: { view } });
}
type Listening = ReturnType<typeof useListening>;
/** What the bar says in place of the artist and section while there is no audio to describe. */
function narrationStatus(audio: Listening) {
  if (audio.phase === "loading") return preparationLabel(audio.preparationStage);
  if (audio.phase === "error") return "Couldn’t play · Tap to retry";
}
function NarrationToggle({
  audio,
  status,
  progress: { timeline, scale },
}: {
  audio: Listening;
  status?: string;
  progress: ReturnType<typeof guideProgress>;
}) {
  if (audio.phase === "loading") {
    return <LoadingRing accessibilityLabel={status} size={RING_SIZE} style={styles.control} />;
  }
  return (
    <View style={styles.control}>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.ring}
      >
        <SectionRing
          size={RING_SIZE}
          timeline={timeline}
          scale={scale}
          position={canSeekTo(audio, 0) ? audio.position : 0}
          available={audio.duration ? 0 : audio.availableDuration}
        />
      </View>
      <AudioIconButton
        name={audio.phase === "error" ? "arrow.clockwise" : audio.playing ? "pause.fill" : "play.fill"}
        label={audio.phase === "error" ? "Retry narration" : audio.playing ? "Pause narration" : "Play narration"}
        onPress={() => {
          playLightHaptic();
          audio.controller.toggle();
        }}
        color={Gallery.accent}
        size={16}
        morphs
      />
    </View>
  );
}
/** The bar's tappable summary: a tap opens the player, a long press offers listening actions without opening it. */
function PlayerSummary({
  audio,
  accessibilityLabel,
  children,
}: {
  audio: Listening;
  accessibilityLabel: string;
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
          accessibilityActions={actions.map(({ name, label }) => ({ name, label }))}
          onAccessibilityAction={({ nativeEvent }) =>
            actions.find((action) => action.name === nativeEvent.actionName)?.run()
          }
          style={styles.summary}
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
  const { title, artist, imageUri } = audio.current.work;
  const status = narrationStatus(audio);
  const progress = guideProgress(audio);
  const section = progress.timeline && sectionAt(progress.timeline, audio.position);
  const sectionTitle = section && GUIDE_SECTION_TITLES[section];
  const description = status ?? [artist, sectionTitle].filter(Boolean).join(", ");
  const byline = { fontSize: 11, color: Color.ios.secondaryLabel };
  return (
    <View style={styles.row}>
      <PlayerSummary audio={audio} accessibilityLabel={["Open player", title, description].filter(Boolean).join(", ")}>
        <ArtworkThumbnail uri={imageUri} size={32} />
        <View style={{ flex: 1, gap: 2 }}>
          {/* Native colors follow the glass accessory's contrast, even while the app stays in light mode. */}
          <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "600", color: Color.ios.label }}>
            {title}
          </Text>
          {status ? (
            <Text numberOfLines={1} style={byline}>
              {status}
            </Text>
          ) : (
            // A long artist name gives way so the section always reads in full.
            <View style={{ flexDirection: "row" }}>
              {!!artist && (
                <Text numberOfLines={1} style={[byline, { flexShrink: 1 }]}>
                  {artist}
                </Text>
              )}
              {sectionTitle && <Text style={byline}>{artist ? ` · ${sectionTitle}` : sectionTitle}</Text>}
            </View>
          )}
        </View>
      </PlayerSummary>
      <AudioIconButton
        name="gobackward.15"
        label="Back 15 seconds"
        disabled={!canSeekTo(audio, 0)}
        onPress={() => void audio.controller.seek(audio.position - 15)}
        color={Color.ios.label}
        size={22}
      />
      <NarrationToggle audio={audio} status={status} progress={progress} />
    </View>
  );
}
const styles = StyleSheet.create({
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
  control: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", top: (44 - RING_SIZE) / 2, left: (44 - RING_SIZE) / 2 },
});
