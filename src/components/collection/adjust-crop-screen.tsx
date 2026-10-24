import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { router } from "expo-router";
import { useEffect } from "react";

import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { CropEditor } from "@/components/scan/crop-editor";
import { ThemedText } from "@/components/themed-text";
import { selectArtworkPhotos } from "@/db/repos/artwork-album";
import { selectSavedWork } from "@/db/repos/saved-works";
import { useLocalOwner } from "@/lib/account/owner-store";
import { saveEditedArtworkCrop } from "@/lib/capture/edit-crop";
import { reportError } from "@/lib/observability";

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
  const photo = photoId
    ? album.find((row) => row.localId === photoId)
    : (album.find((row) => row.localId === work?.cropPhotoLocalId && row.path)
      ?? album.find((row) => row.kind === "full" && row.path)
      ?? album.find((row) => row.path));
  const source = photo?.path ?? (!photoId ? work?.photoPath : undefined);
  if (!work || !source) {
    return (
      <SafeAreaScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 24, gap: 16 }}>
        <ThemedText>
          {!works.updatedAt || !photos.updatedAt
            ? "Loading your photo…"
            : "The full photo needs to be on this iPhone before you can adjust its crop."}
        </ThemedText>
        <GalleryButton label="Back" onPress={() => router.back()} />
      </SafeAreaScrollView>
    );
  }
  return (
    <CropEditor
      key={`${owner}:${savedId}:${source}`}
      photoPath={source}
      initialCorners={photo?.localId === work.cropPhotoLocalId ? work.cropCorners : null}
      onCancel={() => router.back()}
      onSave={async (crop, isCurrent) => {
        await saveEditedArtworkCrop(savedId, crop, owner, isCurrent);
        if (isCurrent()) router.back();
      }}
    />
  );
}
