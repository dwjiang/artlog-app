import { Host, Switch } from "@expo/ui";
import { accessibilityHint, font } from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { ThemedText as Text } from "@/components/themed-text";
import { GalleryButton } from "@/components/collection/gallery-button";
import { Gallery } from "@/constants/theme";
import { useListening } from "@/lib/audio/use-listening";
import { durationLabel, trackKey } from "@/lib/audio/narration";
import { ArtworkThumbnail } from "./artwork-thumbnail";
import { AudioIconButton } from "./audio-icon";
export function ListeningQueue() {
  const audio = useListening();
  const [editing, setEditing] = useState(false);
  if (!audio.current) return null;
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 12 }}
    >
      <Text
        variant="metadata"
        style={{ color: Gallery.muted, marginVertical: 12 }}
      >
        {audio.playing
          ? "NOW PLAYING"
          : audio.waiting
            ? "READY WHEN YOU ARE"
            : "PAUSED"}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingBottom: 18,
          borderBottomWidth: 0.5,
          borderColor: Gallery.separator,
        }}
      >
        <ArtworkThumbnail uri={audio.current.work.imageUri} size={54} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontWeight: "600", fontSize: 16 }}>
            {audio.current.work.title}
          </Text>
          <Text variant="metadata" themeColor="textSecondary">
            {["Audio guide", durationLabel(audio.duration)]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
      </View>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: 12,
        }}
      >
        <Text variant="display" style={{ fontSize: 30 }}>
          Up next
        </Text>
        <GalleryButton
          label={editing ? "Done" : "Edit"}
          onPress={() => setEditing(!editing)}
          disabled={!audio.queue.length}
        />
      </View>
      {!audio.queue.length && (
        <Text
          themeColor="textSecondary"
          style={{ fontSize: 14, paddingVertical: 16 }}
        >
          Nothing queued. Add an artwork from your collection.
        </Text>
      )}
      {audio.queue.map((track, index) => (
        <View
          key={trackKey(track)}
          style={{
            paddingVertical: 12,
            borderBottomWidth: 0.5,
            borderColor: Gallery.softBorder,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Play ${track.work.title}`}
              onPress={() => void audio.controller.play(track)}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              }}
            >
              <ArtworkThumbnail uri={track.work.imageUri} size={46} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ fontSize: 14, fontWeight: "600" }}>
                  {track.work.title}
                </Text>
                <Text variant="metadata" themeColor="textSecondary">
                  {track.work.artist}
                </Text>
                <Text variant="metadata" themeColor="textSecondary">
                  {[
                    "Audio guide",
                    durationLabel(
                      audio.controller.progressFor(track)?.duration,
                    ),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            </Pressable>
            {!editing && (
              <AudioIconButton
                name="line.3.horizontal"
                label={`Reorder ${track.work.title}`}
                color={Gallery.muted}
                onPress={() => setEditing(true)}
              />
            )}
          </View>
          {editing && (
            <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
              <AudioIconButton
                name="arrow.up"
                label={`Move ${track.work.title} earlier`}
                disabled={index === 0}
                onPress={() => audio.controller.move(trackKey(track), -1)}
              />
              <AudioIconButton
                name="arrow.down"
                label={`Move ${track.work.title} later`}
                disabled={index === audio.queue.length - 1}
                onPress={() => audio.controller.move(trackKey(track), 1)}
              />
              <AudioIconButton
                name="trash"
                label={`Remove ${track.work.title}`}
                color={Gallery.destructive}
                onPress={() => audio.controller.remove(trackKey(track))}
              />
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}
export function QueueOptions({ onAdd }: { onAdd: () => void }) {
  const audio = useListening();
  const { height, fontScale } = useWindowDimensions();
  if (height < 720 && fontScale <= 1.4) {
    return (
      <View
        style={{
          paddingHorizontal: 24,
          borderTopWidth: 0.5,
          borderColor: Gallery.softBorder,
          flexDirection: "row",
          alignItems: "center",
          gap: 18,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add saved works"
          onPress={onAdd}
          style={{ minHeight: 48, justifyContent: "center" }}
        >
          <Text style={{ fontSize: 12, color: Gallery.accent }}>
            + Add saved works
          </Text>
        </Pressable>
        <Host
          matchContents={{ vertical: true }}
          style={{ flex: 1 }}
          colorScheme="light"
          seedColor={Gallery.accent}
          ignoreSafeArea="all"
        >
          <Switch
            label="Pause between artworks"
            value={audio.pauseBetween}
            onValueChange={audio.controller.setPauseBetween}
            modifiers={[
              font({ textStyle: "caption" }),
              accessibilityHint(
                audio.pauseBetween
                  ? "Tap Play when you reach the next work."
                  : "Play the next work automatically.",
              ),
            ]}
          />
        </Host>
      </View>
    );
  }
  return (
    <View
      style={{
        paddingHorizontal: 24,
        borderTopWidth: 0.5,
        borderColor: Gallery.softBorder,
      }}
    >
      <GalleryButton label="Add saved works" icon="plus" onPress={onAdd} />
      <Host
        matchContents={{ vertical: true }}
        colorScheme="light"
        seedColor={Gallery.accent}
        ignoreSafeArea="all"
      >
        <Switch
          label="Pause between artworks"
          value={audio.pauseBetween}
          onValueChange={audio.controller.setPauseBetween}
        />
      </Host>
      <Text
        variant="metadata"
        themeColor="textSecondary"
        style={{ paddingBottom: 8 }}
      >
        {audio.pauseBetween
          ? "Tap Play when you reach the next work."
          : "Play the next work automatically."}
      </Text>
    </View>
  );
}
