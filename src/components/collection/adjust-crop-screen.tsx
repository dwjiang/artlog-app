import { useEffect } from "react";
import { reportError } from "@/lib/observability";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router } from "expo-router";
import { ScrollView } from "react-native";

import { selectArtworkPhotos } from "@/db/repos/artwork-album";
import { selectSavedWork } from "@/db/repos/saved-works";
import { useLocalOwner } from "@/lib/account/owner-store";
import { saveEditedArtworkCrop } from "@/lib/capture/edit-crop";
import { CropEditor } from "../scan/crop-editor";
import { ThemedText } from "../themed-text";
import { GalleryButton } from "./gallery-button";

export function AdjustCropScreen({ savedId, photoId }: { savedId: string; photoId?: string }) {
  const owner = useLocalOwner();
  const works = useLiveQuery(selectSavedWork(savedId, owner), [savedId, owner]);
  const photos = useLiveQuery(selectArtworkPhotos(savedId, owner), [savedId, owner]);
  const queryError = works.error ?? photos.error;
  useEffect(() => {
    if (queryError) reportError(queryError, "collection.crop-source.load");
  }, [queryError]);
  const work = works.data.find((row) => row.owner === owner && row.deletedAt === null);
  const album = photos.data.filter(
    (row) => row.owner === owner && row.savedLocalId === savedId && row.deletedAt === null && row.kind !== "label",
  );
  const source = photoId
    ? album.find((row) => row.localId === photoId)?.path
    : (album.find((row) => row.path === work?.photoPath)?.path
      ?? album.find((row) => row.kind === "full" && row.path)?.path
      ?? album.find((row) => row.path)?.path
      ?? work?.photoPath);
  if (!work || !source) {
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 24, gap: 16 }}>
        <ThemedText>
          {!works.updatedAt || !photos.updatedAt
            ? "Loading your photo…"
            : "The full photo needs to be on this iPhone before you can adjust its crop."}
        </ThemedText>
        <GalleryButton label="Back" onPress={() => router.back()} />
      </ScrollView>
    );
  }
  return (
    <CropEditor
      key={`${owner}:${savedId}:${source}`}
      photoPath={source}
      onCancel={() => router.back()}
      onSave={async (crop, isCurrent) => {
        await saveEditedArtworkCrop(savedId, crop, owner, isCurrent);
        if (isCurrent()) router.back();
      }}
    />
  );
}
