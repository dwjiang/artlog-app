import { Host, Icon } from "@expo/ui";
import { Button, Menu } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle, frame } from "@expo/ui/swift-ui/modifiers";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ReportableHeading } from "@/components/reportable-heading";
import { ThemedText as Text } from "@/components/themed-text";
import { ToastLayer } from "@/components/toast";
import { Gallery, PinnedFooterBorder, Spacing } from "@/constants/theme";
import type { ListeningWork } from "@/lib/audio/narration";
import { useListening } from "@/lib/audio/use-listening";

import { AddSavedWorks } from "./add-saved-works";
import { AudioIcon, AudioIconButton } from "./audio-icon";
import { GuideFollowAlong } from "./guide-follow-along";
import { ListeningQueue } from "./listening-queue";
import { PlayerTransport, type PlayerView } from "./player-transport";

export function NowPlayingScreen() {
  const { view: initialView } = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<PlayerView>(initialView === "queue" ? "queue" : "player");
  const audio = useListening();
  const { bottom } = useSafeAreaInsets();
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
  return (
    <View style={[styles.screen, { paddingBottom: Math.max(8, bottom) }]}>
      <View style={styles.header}>
        <AudioIconButton name="chevron.down" label="Minimize player" onPress={() => router.back()} />
        {view === "saved" ? (
          <>
            <Text variant="secondary" style={styles.headerTitle}>
              Add saved works
            </Text>
            <GalleryButton label="Done" onPress={() => setView("queue")} />
          </>
        ) : (
          options
        )}
      </View>
      {view === "player" && (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.player}
          contentInsetAdjustmentBehavior="never"
          alwaysBounceVertical={false}
        >
          <ArtworkPrint work={work} />
          <View style={styles.label}>
            <Text selectable variant="display" style={styles.title}>
              {work.title}
            </Text>
            <Text selectable variant="secondary" themeColor="textSecondary">
              {[work.artist, work.date].filter(Boolean).join(" · ")}
            </Text>
            <ReportableHeading
              report={
                audio.renderId ? { kind: "audio", artworkId: work.artworkId, renderId: audio.renderId } : undefined
              }
              disabled={audio.phase === "loading"}
            >
              <Text variant="metadata" themeColor="textSecondary">
                AI-generated voice
              </Text>
            </ReportableHeading>
          </View>
        </ScrollView>
      )}
      {view === "transcript" && <GuideFollowAlong />}
      {view === "queue" && <ListeningQueue onAdd={() => setView("saved")} />}
      {view === "saved" && <AddSavedWorks />}
      <View style={view !== "player" && styles.footer}>
        <PlayerTransport view={view} onView={setView} />
      </View>
      <ToastLayer offset={0} />
    </View>
  );
}

/** The artwork hung like a print: drawn at its own proportions so the paper shadow follows its edges. */
function ArtworkPrint({ work }: { work: ListeningWork }) {
  const [space, setSpace] = useState({ width: 0, height: 0 });
  const [aspect, setAspect] = useState(1);
  const fit = (ratio: number) => {
    const width = Math.min(space.width, space.height * ratio);
    const height = width / ratio;
    // Placed absolutely, the print never adds to the height it is fitted into, so it cannot push the label away.
    return { width, height, left: (space.width - width) / 2, top: (space.height - height) / 2 };
  };
  return (
    <View
      style={styles.print}
      onLayout={({ nativeEvent: { layout } }) => setSpace({ width: layout.width, height: layout.height })}
    >
      {space.width > 0 && space.height > 0 && work.imageUri ? (
        <View style={[styles.paper, styles.placed, fit(aspect)]}>
          <Image
            source={work.imageUri}
            cachePolicy={work.imageUri.startsWith("file:") ? "memory" : "disk"}
            contentFit="contain"
            onLoad={({ source }) => {
              if (source.width > 0 && source.height > 0) setAspect(source.width / source.height);
            }}
            style={styles.fill}
            accessible
            accessibilityLabel={work.title}
          />
        </View>
      ) : (
        space.width > 0
        && space.height > 0 && (
          <View style={[styles.noArtwork, styles.placed, fit(1)]}>
            <AudioIcon name="photo" size={70} color={Gallery.muted} />
          </View>
        )
      )}
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
  headerTitle: { fontWeight: "600", flex: 1, textAlign: "center" },
  fill: { flex: 1 },
  // The print takes whatever height the label and transport leave, and the page scrolls once that is too little.
  player: { flexGrow: 1 },
  print: {
    flex: 1,
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: Spacing.four,
    marginVertical: Spacing.four,
  },
  paper: {
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 2, color: "rgba(27,37,49,0.12)" },
      { offsetX: 0, offsetY: 10, blurRadius: 26, color: "rgba(27,37,49,0.16)" },
    ],
  },
  placed: { position: "absolute" },
  noArtwork: { backgroundColor: Gallery.fill, alignItems: "center", justifyContent: "center" },
  label: { paddingHorizontal: Spacing.content, paddingBottom: Spacing.two, gap: Spacing.one },
  title: { fontSize: 28, lineHeight: 34 },
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
