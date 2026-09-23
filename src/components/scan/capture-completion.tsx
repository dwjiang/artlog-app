import { NotePaper } from "../note-paper";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import type { CaptureCompletion as Completion } from "@/lib/capture/completion";
import { captureFileUri } from "@/lib/files/photos";
import { GalleryButton } from "../collection/gallery-button";

export function CaptureCompletion({
  completion,
  onViewResult,
  inline = false,
  sharedToIndex = false,
}: {
  completion: Completion;
  onViewResult?: () => void;
  inline?: boolean;
  sharedToIndex?: boolean;
}) {
  const router = useRouter();
  const content = (
    <>
      {!!completion.photoPaths[0] && (
        <Image
          source={{ uri: captureFileUri(completion.photoPaths[0]) }}
          contentFit="contain"
          style={{ width: "100%", height: 220, backgroundColor: Gallery.fill }}
          accessibilityLabel="Saved photo preview"
        />
      )}
      <View
        style={{
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          backgroundColor: Gallery.highlight,
          padding: 6,
        }}
      >
        <Image source="sf:checkmark" style={{ width: 14, height: 14 }} tintColor={Gallery.ink} />
        <ThemedText type="small">Saved to your collection</ThemedText>
      </View>
      <ThemedText style={styles.copy}>{completion.title}</ThemedText>
      <ThemedText style={styles.copy}>{completion.visitLabel}</ThemedText>
      <NotePaper label="Private note">
        <GalleryButton
          label="Add a private note"
          icon="square.and.pencil"
          fullWidth
          onPress={() =>
            router.navigate({
              pathname: "/saved/[savedId]",
              params: { savedId: completion.savedId, editNote: "1" },
            })
          }
        />
      </NotePaper>
      <GalleryButton
        label="Scan next artwork"
        icon="arrow.right"
        iconPosition="trailing"
        variant="filled"
        fullWidth
        onPress={() => {
          router.dismissAll();
          router.navigate("/(tabs)/(scan)/scan");
        }}
      />
      <GalleryButton
        label="View artwork"
        fullWidth
        onPress={() =>
          router.navigate({ pathname: "/saved/[savedId]", params: { savedId: completion.savedId } })
        }
      />
      {onViewResult && <GalleryButton label="View result" fullWidth onPress={onViewResult} />}
      <ThemedText type="small" style={styles.note}>
        {sharedToIndex
          ? "An artwork crop was saved to the shared index."
          : "New photos are private."}{" "}
        Your wall and shared visits haven’t changed.
      </ThemedText>
    </>
  );
  return inline ? (
    <View style={styles.content}>{content}</View>
  ) : (
    <ScrollView
      style={styles.page}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      {content}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Gallery.paper },
  content: { flexGrow: 1, padding: 20, gap: 16 },
  copy: { color: Gallery.muted },
  note: { color: Gallery.muted, textAlign: "center" },
});
