import { useQueries, type RequestForQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LoadingRing } from "@/components/loading-ring";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { useDeviceReady } from "@/lib/use-device-ready";
import { useListening } from "@/lib/audio/use-listening";
import { useCachedNarrationDuration } from "@/lib/audio/use-cached-narration-duration";
import { durationLabel, trackKey, researchKey, type ListeningWork } from "@/lib/audio/narration";
import { openPlayer } from "./mini-player";
import { AudioIcon, AudioIconButton } from "./audio-icon";

export function ListenActions({
  artworkId,
  title,
  artist,
  imageUri,
  savedId,
  scanId,
}: {
  artworkId: Id<"artworks">;
  title: string;
  artist: string;
  imageUri?: string;
  savedId?: string;
  scanId?: string;
}) {
  const ready = useDeviceReady();
  const queries = useMemo(
    (): RequestForQueries =>
      ready
        ? {
            enrichment: { query: api.artworks.enrichment, args: { artworkId } },
          }
        : {},
    [ready, artworkId],
  );
  const {
    enrichment,
  }: {
    enrichment?: FunctionReturnType<typeof api.artworks.enrichment> | Error;
  } = useQueries(queries);
  const data = enrichment instanceof Error ? undefined : enrichment;
  const audio = useListening();
  const facts = data?.narrationFacts ?? [];
  const cachedDuration = useCachedNarrationDuration(data?.narrationRenderId);
  if (!data || !facts.length) return null;
  const work: ListeningWork = {
    artworkId,
    title,
    artist,
    imageUri: imageUri ?? data.thumbnailUrl,
    savedId,
    scanId,
    facts,
    researchUpdatedAt: data.narrationResearchUpdatedAt,
    opening: data.narrationOpening,
    renderId: data.narrationRenderId,
  };
  const track = { work };
  const same =
    !!audio.current && trackKey(audio.current) === trackKey(track) && researchKey(audio.current) === researchKey(track);
  const another = !!scanId && !!audio.current && audio.current.work.artworkId !== artworkId;
  const queued = audio.queue.some((item) => item.work.artworkId === artworkId);
  const savedProgress = audio.controller.progressFor(track);
  const remaining =
    same && audio.duration
      ? Math.max(0, audio.duration - audio.position)
      : savedProgress
        ? Math.max(0, savedProgress.duration - savedProgress.position)
        : undefined;
  const resume = remaining !== undefined && remaining > 0 && (same ? audio.position > 0 : !!savedProgress?.position);
  const preparing = same && audio.phase === "loading";
  const duration = durationLabel(
    resume ? remaining : same && audio.duration ? audio.duration : savedProgress?.duration || cachedDuration,
  );
  const actionLabel = preparing
    ? "Preparing narration…"
    : same && audio.phase === "error"
      ? "Retry narration"
      : same && audio.playing
        ? "Now playing"
        : resume
          ? "Resume listening"
          : "Listen to this work";
  const label = another ? (queued ? "Added to queue" : "Add to queue") : actionLabel;
  const inPlayer = audio.current?.work.artworkId === artworkId;
  const queuedHere = queued || inPlayer;
  function listen() {
    if (!same) void audio.controller.play(track);
    else if (!audio.playing) audio.controller.toggle();
    openPlayer();
  }
  function enqueue() {
    if (!audio.current) void audio.controller.play(track, false, true);
    else audio.controller.enqueue(track);
  }
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={another ? "Keeps the current audio guide playing." : "Opens the audio guide player."}
        accessibilityState={{
          busy: preparing,
          disabled: preparing || (another && queued),
        }}
        disabled={preparing || (another && queued)}
        onPress={another ? enqueue : listen}
        style={({ pressed }) => [styles.listen, pressed && { opacity: 0.65 }]}
      >
        <View style={[styles.play, another && queued && styles.queued]}>
          {preparing ? (
            <LoadingRing color={Gallery.surface} />
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
            />
          )}
        </View>
        <View style={styles.copy}>
          <ThemedText variant="button" style={{ color: Gallery.accent }}>
            {label}
          </ThemedText>
          <ThemedText variant="metadata" themeColor="textSecondary">
            {duration ? `${duration}${resume ? " left" : ""} · ` : ""}
            AI-generated voice
          </ThemedText>
        </View>
      </Pressable>
      <AudioIconButton
        name={another ? "play.fill" : queuedHere ? "checkmark" : "text.badge.plus"}
        label={another ? "Listen now" : inPlayer ? "Already in player" : queued ? "Added to queue" : "Add to queue"}
        color={Gallery.accent}
        size={20}
        disabled={!another && queuedHere}
        onPress={another ? listen : enqueue}
        style={styles.queue}
      />
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
