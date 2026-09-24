import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Image } from "expo-image";
import { useEffect } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { LoadingImage } from "@/components/loading-image";
import { PhotoStripSkeleton } from "@/components/loading-skeleton";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { selectVisitArtworkPhotos } from "@/db/repos/artwork-album";
import type { SavedWork } from "@/db/schema";
import { captureFileUri } from "@/lib/files/photos";
import { reportError } from "@/lib/observability";

export function SharePhotoPicker({
  work,
  visitId,
  selected,
  onChange,
  onDone,
}: {
  work: SavedWork;
  visitId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  onDone: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  const { data, updatedAt, error } = useLiveQuery(selectVisitArtworkPhotos(work.localId, visitId, work.owner), [
    work.localId,
    visitId,
    work.owner,
  ]);
  useEffect(() => {
    if (error) reportError(error, "visit.share-photos.load");
  }, [error]);
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} style={{ backgroundColor: Gallery.paper }}>
      <GalleryButton label="Done" icon="chevron.left" onPress={onDone} />
      <Text
        style={{
          color: Gallery.ink,
          fontSize: 28,
          lineHeight: 33,
          fontWeight: "600",
          letterSpacing: -0.8,
        }}
      >
        Choose photos
      </Text>
      <Text style={{ color: Gallery.muted, fontSize: 13, lineHeight: 19 }}>
        {work.title}
        {"\n"}
        {selected.length} of {data.length} photos selected
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
          Photos could not load. Reopen the photo picker to try again.
        </Text>
      ) : !updatedAt && data.length === 0 ? (
        <PhotoStripSkeleton />
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {data
          .filter((row) => row.owner === work.owner)
          .map((photo) => (
            <Pressable
              key={photo.localId}
              accessibilityRole="checkbox"
              accessibilityLabel={`Share ${photo.kind} photo${photo.caption ? `: ${photo.caption}` : ""}`}
              accessibilityState={{ checked: selected.includes(photo.localId) }}
              onPress={() =>
                onChange(
                  selected.includes(photo.localId)
                    ? selected.filter((id) => id !== photo.localId)
                    : [...selected, photo.localId],
                )
              }
              style={{
                width: fontScale > 1.4 ? "100%" : "47%",
                borderRadius: 2,
                overflow: "hidden",
                borderWidth: 2,
                borderColor: selected.includes(photo.localId) ? Gallery.accent : Gallery.fill,
                backgroundColor: Gallery.fill,
                padding: 8,
                gap: 8,
              }}
            >
              {photo.path ? (
                <LoadingImage
                  uri={captureFileUri(photo.path)}
                  label={`${photo.kind} photo`}
                  style={{ width: "100%", height: 155 }}
                  contentFit="contain"
                />
              ) : (
                <Text style={{ color: Gallery.muted }}>Photo unavailable on this iPhone.</Text>
              )}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 13, color: Gallery.ink }}>
                  {photo.kind === "full" ? "Full artwork" : photo.kind === "detail" ? "Detail" : "Museum label"}
                </Text>
                <Image
                  source={selected.includes(photo.localId) ? "sf:checkmark.circle.fill" : "sf:circle"}
                  accessible={false}
                  tintColor={selected.includes(photo.localId) ? Gallery.accent : Gallery.muted}
                  style={{ width: 18, height: 18 }}
                />
              </View>
              {!!photo.caption && <Text style={{ color: Gallery.muted, fontSize: 13 }}>{photo.caption}</Text>}
            </Pressable>
          ))}
      </View>
      <Text style={{ color: Gallery.muted, fontSize: 13 }}>
        {selected.length} selected · Captions and private notes stay private.
      </Text>
    </ScrollView>
  );
}
