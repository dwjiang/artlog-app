import { Host, Icon } from "@expo/ui";
import { Button, Menu } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, frame } from "@expo/ui/swift-ui/modifiers";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ReportableHeading } from "@/components/reportable-heading";
import { DocentSection } from "@/components/scan/result/docent-section";
import { ThemedText as Text } from "@/components/themed-text";
import { ToastLayer } from "@/components/toast";
import { Gallery, PinnedFooterBorder, Spacing } from "@/constants/theme";
import { useListening } from "@/lib/audio/use-listening";

import { AddSavedWorks } from "./add-saved-works";
import { AudioIcon, AudioIconButton } from "./audio-icon";
import { ListeningQueue } from "./listening-queue";
import { PlayerTransport, type PlayerView, transportStacks } from "./player-transport";

export function NowPlayingScreen() {
  const { view: initialView } = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<PlayerView>(initialView === "queue" ? "queue" : "player");
  const audio = useListening();
  const { bottom } = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  if (!audio.current) {
    return (
      <View style={styles.empty}>
        <Text>No artwork is playing.</Text>
        <AudioIconButton name="chevron.down" label="Close player" onPress={() => router.back()} />
      </View>
    );
  }
  const { work } = audio.current;
  function openArtwork() {
    router.back();
    if (work.savedId) {
      router.push({
        pathname: "/saved/[savedId]",
        params: { savedId: work.savedId },
      });
    } else if (work.scanId) {
      router.push({
        pathname: "/result/[scanId]",
        params: { scanId: work.scanId },
      });
    }
  }
  const options = (
    <Host matchContents colorScheme="light">
      <Menu
        modifiers={[buttonStyle("plain"), accessibilityLabel("Listening options")]}
        label={<Icon name="ellipsis" size={22} color={Gallery.ink} modifiers={[frame({ width: 44, height: 44 })]} />}
      >
        {(work.savedId || work.scanId) && (
          <Button label="View this artwork" systemImage="photo" onPress={openArtwork} />
        )}
        <Button label="Restart narration" systemImage="arrow.counterclockwise" onPress={audio.controller.restart} />
        <Button
          label="Stop listening & close player"
          systemImage="stop"
          role="destructive"
          onPress={() => {
            audio.controller.stop();
            router.back();
          }}
        />
      </Menu>
    </Host>
  );
  const metadata = (
    <View style={styles.metadata}>
      <ReportableHeading
        report={audio.renderId ? { kind: "audio", artworkId: work.artworkId, renderId: audio.renderId } : undefined}
        disabled={audio.phase === "loading"}
      >
        <Text variant="metadata" themeColor="textSecondary">
          AI-generated voice
        </Text>
      </ReportableHeading>
      <Text selectable variant="display" style={styles.title}>
        {work.title}
      </Text>
      <Text selectable variant="secondary" themeColor="textSecondary">
        {work.artist}
      </Text>
    </View>
  );
  const compact = height < 720;
  // Only a stacked transport can outgrow the sheet; otherwise the artwork shrinks so the player never scrolls.
  const scrolls = transportStacks(width, fontScale);
  const artworkSize = Math.min(width - Spacing.content * 2, scrolls ? height * 0.24 : 360);
  const artwork = (
    <View
      style={[
        styles.artwork,
        !work.imageUri && styles.noArtwork,
        scrolls ? { height: artworkSize } : { flex: 1, maxHeight: artworkSize },
      ]}
    >
      {work.imageUri ? (
        <Image
          source={work.imageUri}
          cachePolicy={work.imageUri.startsWith("file:") ? "memory" : "disk"}
          contentFit="contain"
          style={{ width: "100%", height: "100%" }}
          accessible
          accessibilityLabel={work.title}
        />
      ) : (
        <AudioIcon name="photo" size={70} color={Gallery.muted} />
      )}
    </View>
  );
  const status = audio.waiting && audio.phase === "ready" && (
    <Text variant="secondary" style={{ color: Gallery.muted }}>
      Ready to play
    </Text>
  );
  const transport = <PlayerTransport view={view} onView={setView} />;
  const player = (
    <>
      <View style={[styles.artworkSpace, !scrolls && styles.fill, compact && { paddingVertical: Spacing.three }]}>
        {artwork}
      </View>
      <View style={styles.details}>
        {metadata}
        {status}
      </View>
      {transport}
    </>
  );
  return (
    <View style={[styles.screen, { paddingBottom: Math.max(8, bottom) }]}>
      <View style={styles.header}>
        <AudioIconButton name="chevron.down" label="Minimize player" onPress={() => router.back()} />
        <Text variant="secondary" style={{ fontWeight: "600", flex: 1, textAlign: "center" }}>
          {view === "transcript"
            ? "Transcript"
            : view === "saved"
              ? "Add saved works"
              : audio.phase === "loading"
                ? "Preparing audio"
                : "Now playing"}
        </Text>
        {view === "saved" ? <GalleryButton label="Done" onPress={() => setView("queue")} /> : options}
      </View>
      {view === "player"
        && (scrolls ? (
          <ScrollView style={styles.scroll} contentInsetAdjustmentBehavior="never">
            {player}
          </ScrollView>
        ) : (
          <View style={styles.scroll}>{player}</View>
        ))}
      {view === "queue" && <ListeningQueue onAdd={() => setView("saved")} />}
      {view === "saved" && <AddSavedWorks />}
      {view === "transcript" && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{
            padding: Spacing.content,
            gap: Spacing.three,
          }}
        >
          <ReportableHeading report={{ kind: "transcript", artworkId: work.artworkId }} disabled={!audio.sentences}>
            <Text variant="display">{work.title}</Text>
          </ReportableHeading>
          {audio.sentences ? (
            <DocentSection docent={audio.sentences} factSheet={work.facts} />
          ) : (
            <Text themeColor="textSecondary">The transcript will appear when your audio guide is ready.</Text>
          )}
        </ScrollView>
      )}
      {view !== "player" && (
        <View style={styles.footer}>
          <View style={{ paddingHorizontal: Spacing.content }}>{status}</View>
          {transport}
        </View>
      )}
      <ToastLayer offset={0} />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Gallery.paper, paddingTop: 12 },
  header: {
    minHeight: 44,
    flexShrink: 0,
    marginHorizontal: Spacing.compact,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  scroll: { flex: 1, overflow: "hidden" },
  artworkSpace: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.four,
  },
  fill: { flex: 1 },
  artwork: { aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  noArtwork: { backgroundColor: Gallery.fill },
  details: { paddingHorizontal: Spacing.content, gap: Spacing.two },
  metadata: { gap: Spacing.two, paddingBottom: Spacing.two },
  title: { fontSize: 30, lineHeight: 36 },
  footer: {
    backgroundColor: Gallery.paper,
    ...PinnedFooterBorder,
  },
  empty: {
    flex: 1,
    backgroundColor: Gallery.paper,
    alignItems: "center",
    justifyContent: "center",
  },
});
