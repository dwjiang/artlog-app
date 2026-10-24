import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, TextInput, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { LoadingImage } from "@/components/loading-image";
import { ListSkeleton } from "@/components/loading-skeleton";
import { MotionPressable } from "@/components/motion-pressable";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { editArtworkPhoto, selectArtworkPhotos } from "@/db/repos/artwork-album";
import { listSavedWorks } from "@/db/repos/saved-works";
import type { ArtworkPhoto } from "@/db/schema";
import { useLocalOwner } from "@/lib/account/owner-store";
import { captureFileUri } from "@/lib/files/photos";
import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

import { ArtworkQueryState } from "./artwork-query-state";
import { GalleryButton } from "./gallery-button";
import { NativeSegmentedPicker } from "./native-segmented-picker";
import { PhotoVisibility } from "./photo-visibility";
import { SavedWorkImage } from "./saved-work-image";
import { WallSheet } from "./wall-sheet";

export function PhotoEditorScreen() {
  const { savedId, photoId } = useLocalSearchParams<{
    savedId: string;
    photoId: string;
  }>();
  const owner = useLocalOwner();
  const [attempt, setAttempt] = useState(0);
  return (
    <PhotoQuery
      key={`${owner}:${savedId}:${photoId}:${attempt}`}
      owner={owner}
      savedId={savedId}
      photoId={photoId}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}
function PhotoQuery({
  owner,
  savedId,
  photoId,
  onRetry,
}: {
  owner: string;
  savedId: string;
  photoId: string;
  onRetry: () => void;
}) {
  const photos = useLiveQuery(selectArtworkPhotos(savedId, owner), [savedId, owner]);
  useEffect(() => {
    if (photos.error) reportError(photos.error, "collection.photo.load");
  }, [photos.error]);
  const photo = photos.data.find(
    (row) => row.owner === owner && row.savedLocalId === savedId && row.localId === photoId && row.deletedAt === null,
  );
  return photo ? (
    <PhotoEditor key={`${owner}:${photoId}`} photo={photo} />
  ) : (
    <ArtworkQueryState item="Photo" loading={!photos.updatedAt} error={photos.error} onRetry={onRetry} />
  );
}
function PhotoEditor({ photo }: { photo: ArtworkPhoto }) {
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [kind, setKind] = useState(photo.kind);
  const [moving, setMoving] = useState(false);
  const [captionFocused, setCaptionFocused] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const works = useLiveQuery(listSavedWorks(photo.owner), [photo.owner]);
  useEffect(() => {
    if (works.error) {
      reportError(works.error, "collection.photo-destinations.load");
    }
  }, [works.error]);
  const destinations = works.data.filter(
    (work) => work.owner === photo.owner && work.localId !== photo.savedLocalId && work.deletedAt === null,
  );
  const execute = (patch: Parameters<typeof editArtworkPhoto>[1]) => {
    try {
      editArtworkPhoto(photo.localId, patch, photo.owner);
      router.back();
    } catch (cause) {
      reportError(cause, "collection.photo.update");
      showErrorToast("Couldn’t update this photo.", () => execute(patch));
    }
  };
  return (
    <SafeAreaScrollView
      style={{ flex: 1, backgroundColor: Gallery.paper }}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ padding: 20, gap: 20 }}
    >
      {photo.path && !imageFailed ? (
        <LoadingImage
          uri={captureFileUri(photo.path)}
          onError={() => setImageFailed(true)}
          style={{ width: "100%", height: 220 }}
          contentFit="contain"
          label="Your artwork photo"
        />
      ) : (
        <View
          style={{
            minHeight: 200,
            justifyContent: "center",
            padding: 20,
            backgroundColor: Gallery.fill,
          }}
        >
          <Text style={{ color: Gallery.muted }}>
            {imageFailed
              ? "Image unavailable. Your photo details are still here."
              : "Photo unavailable on this iPhone. You can still edit its details."}
          </Text>
        </View>
      )}
      {photo.kind !== "label" && (
        <GalleryButton
          label="Adjust artwork crop"
          icon="crop"
          disabled={!photo.path || imageFailed}
          onPress={() =>
            router.push({
              pathname: "/adjust-crop",
              params: { savedId: photo.savedLocalId, photoId: photo.localId },
            })
          }
        />
      )}
      <NativeSegmentedPicker
        label="Photo type"
        value={kind}
        options={[
          { value: "full", label: "Full view" },
          { value: "detail", label: "Detail" },
          { value: "label", label: "Label" },
        ]}
        onChange={setKind}
      />
      <View style={{ gap: 8 }}>
        <Text style={{ color: Gallery.ink }}>Photo caption</Text>
        <TextInput
          accessibilityLabel="Photo caption"
          placeholder="Add a caption…"
          placeholderTextColor={Gallery.muted}
          selectionColor={Gallery.accent}
          keyboardAppearance="light"
          onFocus={() => setCaptionFocused(true)}
          onBlur={() => setCaptionFocused(false)}
          multiline
          value={caption}
          onChangeText={setCaption}
          maxLength={2000}
          style={{
            padding: 16,
            minHeight: 90,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: captionFocused ? Gallery.accent : Gallery.controlBorder,
            backgroundColor: Gallery.surface,
            color: Gallery.ink,
            fontSize: 17,
            lineHeight: 25,
          }}
        />
      </View>
      <PhotoVisibility savedId={photo.savedLocalId} photoId={photo.localId} />
      <GalleryButton label="Save photo details" variant="filled" fullWidth onPress={() => execute({ kind, caption })} />
      <View
        style={{
          borderWidth: 1,
          borderColor: Gallery.softBorder,
          borderRadius: 8,
          paddingHorizontal: 12,
        }}
      >
        <GalleryButton
          label="Move to another artwork"
          icon="arrow.right"
          fullWidth
          contentAlignment="leading"
          onPress={() => setMoving(!moving)}
        />
        {moving && (
          <WallSheet title="Move photo" onDismiss={() => setMoving(false)}>
            <View style={{ padding: 20, gap: 16 }}>
              {works.error ? (
                <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
                  Couldn’t load your artworks. Close and reopen this photo to try again.
                </Text>
              ) : !works.updatedAt && destinations.length === 0 ? (
                <ListSkeleton label="Loading artworks…" rows={3} />
              ) : destinations.length === 0 ? (
                <EmptyState
                  compact
                  title="No other artworks available."
                  detail="Save another artwork before moving this photo. Your photo and edits can stay here."
                >
                  <GalleryButton label="Keep it here" fullWidth onPress={() => setMoving(false)} />
                </EmptyState>
              ) : null}
              {destinations.map((work) => (
                <MotionPressable
                  key={work.localId}
                  accessibilityRole="button"
                  accessibilityLabel={`Move photo to ${work.title}`}
                  onPress={() => {
                    execute({ savedLocalId: work.localId, kind, caption });
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 12,
                  }}
                >
                  <SavedWorkImage path={work.cropPath} title={work.title} contain style={{ width: 60, height: 60 }} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text>{work.title}</Text>
                    <Text style={{ color: Gallery.muted, fontSize: 13 }}>{work.artist}</Text>
                  </View>
                  <Text style={{ color: Gallery.muted }}>›</Text>
                </MotionPressable>
              ))}
              <Text style={{ color: Gallery.muted, fontSize: 13 }}>The photo’s type and caption move with it.</Text>
            </View>
          </WallSheet>
        )}
        <GalleryButton
          label="Delete photo"
          icon="trash"
          fullWidth
          contentAlignment="leading"
          destructive
          onPress={() =>
            Alert.alert(
              "Delete this photo?",
              "This removes the photo from your album, wall placements, and shared visits. Your artwork and visits stay.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete photo",
                  style: "destructive",
                  onPress: () => execute({ deletedAt: Date.now() }),
                },
              ],
            )
          }
        />
      </View>
    </SafeAreaScrollView>
  );
}
