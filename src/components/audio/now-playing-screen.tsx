import { Host, Icon } from "@expo/ui";
import { Button, Menu } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, frame } from "@expo/ui/swift-ui/modifiers";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DocentSection } from "@/components/scan/result/docent-section";
import { ThemedText as Text } from "@/components/themed-text";
import { ToastLayer } from "@/components/toast";
import { Gallery, Spacing } from "@/constants/theme";
import { useListening } from "@/lib/audio/use-listening";

import { AddSavedWorks } from "./add-saved-works";
import { AudioIcon, AudioIconButton } from "./audio-icon";
import { ListeningQueue, QueueOptions } from "./listening-queue";
import { PlayerTransport, type PlayerView } from "./player-transport";

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
      <Text variant="metadata" themeColor="textSecondary">
        AI-generated voice
      </Text>
      <Text selectable variant="display" style={styles.title}>
        {work.title}
      </Text>
      <Text selectable variant="secondary" themeColor="textSecondary">
        {work.artist}
      </Text>
    </View>
  );
  const compact = height < 720;
  const artworkSize = Math.min(width - Spacing.content * 2, height * (compact || fontScale > 1.4 ? 0.24 : 0.35), 360);
  const artwork = (
    <View style={[styles.artwork, !work.imageUri && styles.noArtwork, { width: artworkSize, height: artworkSize }]}>
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
  return (
    <View style={[styles.screen, { paddingBottom: Math.max(8, bottom) }]}>
      <View style={styles.header}>
        <AudioIconButton name="chevron.down" label="Minimize player" onPress={() => router.back()} />
        <Text variant="secondary" style={{ fontWeight: "600", flex: 1, textAlign: "center" }}>
          {view === "player"
            ? audio.phase === "loading"
              ? "Preparing audio"
              : "Now playing"
            : view === "transcript"
              ? "Transcript"
              : "Audio guide"}
        </Text>
        {view === "player" ? (
          options
        ) : (
          <AudioIconButton
            name="waveform"
            label="Back to Now Playing"
            color={Gallery.accent}
            onPress={() => setView("player")}
          />
        )}
      </View>
      {view === "player" && (
        <ScrollView style={styles.scroll} contentInsetAdjustmentBehavior="never">
          <View style={[styles.artworkSpace, compact && { paddingVertical: Spacing.three }]}>{artwork}</View>
          <View style={styles.details}>
            {metadata}
            {status}
          </View>
          {transport}
        </ScrollView>
      )}
      {view === "queue" && (
        <>
          <ListeningQueue />
          <QueueOptions onAdd={() => setView("saved")} />
        </>
      )}
      {view === "saved" && <AddSavedWorks />}
      {view === "transcript" && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{
            padding: Spacing.content,
            gap: Spacing.three,
          }}
        >
          <Text variant="display">{work.title}</Text>
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
  artwork: { alignItems: "center", justifyContent: "center" },
  noArtwork: { backgroundColor: Gallery.fill },
  details: { paddingHorizontal: Spacing.content, gap: Spacing.two },
  metadata: { gap: Spacing.two, paddingBottom: Spacing.two },
  title: { fontSize: 30, lineHeight: 36 },
  footer: {
    backgroundColor: Gallery.paper,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Gallery.softBorder,
  },
  empty: {
    flex: 1,
    backgroundColor: Gallery.paper,
    alignItems: "center",
    justifyContent: "center",
  },
});
