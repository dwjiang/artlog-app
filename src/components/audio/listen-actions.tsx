import { StyleSheet, View } from "react-native";

import { LoadingRing } from "@/components/loading-ring";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { durationLabel, trackKey, researchKey, type ListeningWork } from "@/lib/audio/narration";
import { preparationLabel } from "@/lib/audio/narration-preparation";
import { useCachedNarrationDuration } from "@/lib/audio/use-cached-narration-duration";
import { useListening } from "@/lib/audio/use-listening";
import { playLightHaptic } from "@/lib/ui/haptics";
import { useArtworkEnrichment } from "@/lib/use-artwork-enrichment";

import type { Id } from "../../../convex/_generated/dataModel";
import { AudioIcon, AudioIconButton } from "./audio-icon";
import { openPlayer } from "./mini-player";

export function ListenActions({
  artworkId,
  title,
  artist,
  date,
  imageUri,
  savedId,
  scanId,
}: {
  artworkId: Id<"artworks">;
  title: string;
  artist: string;
  date?: string | null;
  imageUri?: string;
  savedId?: string;
  scanId?: string;
}) {
  const enrichment = useArtworkEnrichment(artworkId);
  const data = enrichment instanceof Error ? undefined : enrichment;
  const audio = useListening();
  const cachedDuration = useCachedNarrationDuration(data?.narrationRenderId);
  if (!data?.narrationAvailable) return null;
  const work: ListeningWork = {
    artworkId,
    title,
    artist,
    date: date || undefined,
    imageUri: imageUri ?? data.thumbnailUrl,
    savedId,
    scanId,
    facts: data.narrationFacts ?? [],
    researchUpdatedAt: data.narrationResearchUpdatedAt,
    opening: data.narrationOpening,
    renderId: data.narrationRenderId,
  };
  const track = { work };
  // A play pressed before the work had research is still this guide once that research lands.
  const same =
    !!audio.current
    && trackKey(audio.current) === trackKey(track)
    && (researchKey(audio.current) === researchKey(track) || audio.current.work.facts.length === 0);
  const another = !!scanId && !!audio.current && audio.current.work.artworkId !== artworkId;
  const queued = audio.queue.some((item) => item.work.artworkId === artworkId);
  const savedProgress = audio.controller.progressFor(track);
  const progress = same ? { position: audio.position, duration: audio.duration } : savedProgress;
  // A guide paused while still streaming has no length yet, so it resumes without a remaining time.
  const remaining = progress?.duration ? Math.max(0, progress.duration - progress.position) : undefined;
  const resume = !!progress && progress.position > 0 && (remaining === undefined || remaining > 0);
  const preparing = same && audio.phase === "loading";
  const duration = durationLabel(
    resume ? remaining : same && audio.duration ? audio.duration : savedProgress?.duration || cachedDuration,
  );
  const actionLabel = preparing
    ? preparationLabel(audio.preparationStage)
    : same && audio.phase === "error"
      ? "Retry audio guide"
      : same && audio.playing
        ? "Now playing"
        : resume
          ? "Resume audio guide"
          : "Play audio guide";
  const label = another ? (queued ? "Added to queue" : "Add to queue") : actionLabel;
  const inPlayer = audio.current?.work.artworkId === artworkId;
  const queuedHere = queued || inPlayer;
  function listen() {
    if (!same) void audio.controller.play(track);
    else if (!preparing && !audio.playing) audio.controller.toggle();
    openPlayer();
  }
  function enqueue() {
    playLightHaptic();
    if (!audio.current) void audio.controller.play(track, false, true);
    else audio.controller.enqueue(track);
  }
  return (
    <View style={styles.row}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={another ? "Keeps the current audio guide playing." : "Opens the audio guide player."}
        accessibilityState={{
          busy: preparing,
          disabled: another && queued,
        }}
        disabled={another && queued}
        onPress={another ? enqueue : listen}
        style={styles.listen}
      >
        <View style={[styles.play, another && queued && styles.queued]}>
          {preparing ? (
            <LoadingRing color={Gallery.surface} size={24} accessible={false} />
          ) : (
            <AudioIcon
              name={
                another
                  ? queued
                    ? "checkmark"
                    : "text.badge.plus"
                  : same && audio.phase === "error"
                    ? "arrow.clockwise"
                    : same && audio.playing
                      ? "waveform"
                      : "play.fill"
              }
              size={20}
              color={another && queued ? Gallery.ink : Gallery.surface}
              popOn={another && queued}
            />
          )}
        </View>
        <View style={styles.copy}>
          <ThemedText variant="button" style={{ color: Gallery.accent }}>
            {label}
          </ThemedText>
          <ThemedText variant="metadata" themeColor="textSecondary">
            {preparing
              ? "Tap to view progress"
              : `${duration ? `${duration}${resume ? " left" : ""} · ` : ""}AI-generated voice`}
          </ThemedText>
        </View>
      </MotionPressable>
      {!preparing && (
        <AudioIconButton
          name={another ? "play.fill" : queuedHere ? "checkmark" : "text.badge.plus"}
          label={another ? "Listen now" : inPlayer ? "Already in player" : queued ? "Added to queue" : "Add to queue"}
          color={Gallery.accent}
          size={20}
          popOn={!another && queuedHere}
          disabled={!another && queuedHere}
          onPress={another ? listen : enqueue}
          style={styles.queue}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    marginVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.separator,
  },
  listen: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    minHeight: 48,
  },
  play: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    backgroundColor: Gallery.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  queued: { backgroundColor: Gallery.highlight },
  copy: { flex: 1, gap: Spacing.one },
  queue: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.softBorder,
    borderRadius: Radius.button,
  },
});
