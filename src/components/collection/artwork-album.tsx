import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ActionStack } from "@/components/action-stack";
import { PhotoGallery } from "@/components/artwork/photo-gallery";
import { EmptyState, EmptySymbol } from "@/components/empty-state";
import { LoadingImage } from "@/components/loading-image";
import { ImageSkeleton } from "@/components/loading-skeleton";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius } from "@/constants/theme";
import { selectArtworkPhotos } from "@/db/repos/artwork-album";
import type { SavedWork } from "@/db/schema";
import { captureFileUri } from "@/lib/files/photos";
import { reportError } from "@/lib/observability";

import { GalleryButton } from "./gallery-button";
import { NativeSegmentedPicker } from "./native-segmented-picker";

export function ArtworkAlbum({
  work,
  visitId,
  photoId,
  children,
}: {
  work: SavedWork;
  visitId?: string;
  photoId?: string;
  children?: ReactNode;
}) {
  const photos = useLiveQuery(selectArtworkPhotos(work.localId, work.owner), [work.localId, work.owner]);
  useEffect(() => {
    if (photos.error) reportError(photos.error, "collection.album.load");
  }, [photos.error]);
  const [scope, setScope] = useState<"all" | "visit">(visitId ? "visit" : "all");
  const [requestedPhoto, setRequestedPhoto] = useState(photoId);
  const [page, setPage] = useState(0);
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});
  const [photoSizes, setPhotoSizes] = useState<Record<string, { width: number; height: number }>>({});
  const rows = photos.data.filter(
    (row) =>
      row.owner === work.owner
      && row.savedLocalId === work.localId
      && (scope === "all" || row.visitLocalId === visitId),
  );
  const lastPage = Math.max(0, rows.length - 1);
  if (requestedPhoto && (photos.updatedAt || rows.length > 0)) {
    setPage(
      Math.max(
        0,
        rows.findIndex((row) => row.localId === requestedPhoto),
      ),
    );
    setRequestedPhoto(undefined);
  } else if (page > lastPage) {
    setPage(lastPage);
  }
  const museum = work.institution || work.venueName;
  function addPhotos() {
    router.push({
      pathname: "/add-photos",
      params: {
        draftId: `saved:${work.localId}`,
        savedId: work.localId,
        title: work.title,
        visitId: scope === "visit" ? visitId : undefined,
      },
    });
  }
  return (
    <View style={{ gap: 8 }}>
      {!!visitId && (
        <NativeSegmentedPicker
          label="Photo scope"
          value={scope}
          onChange={(value) => {
            setScope(value);
            setPage(0);
          }}
          options={[
            { value: "visit", label: "This visit" },
            { value: "all", label: "All photos" },
          ]}
        />
      )}
      {rows.length === 0 && !photos.updatedAt && !photos.error ? (
        <ImageSkeleton label="Loading photos…" style={{ width: "100%", aspectRatio: 1 }} />
      ) : (
        rows.length === 0
        && (photos.error ? (
          <Text accessibilityRole="alert" style={styles.secondary}>
            Photos couldn’t load. Close and reopen this artwork to try again.
          </Text>
        ) : (
          <View
            style={{
              minHeight: 160,
              backgroundColor: Gallery.fill,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
            }}
          >
            <EmptySymbol name="photo" />
          </View>
        ))
      )}
      {rows.length > 0 && (
        <View style={{ marginHorizontal: -20 }}>
          <PhotoGallery
            photos={rows.map((photo, index) => ({
              ...photo,
              ...photoSizes[photo.path ?? ""],
              id: photo.localId,
              label: `${photo.kind} photo ${index + 1}`,
            }))}
            page={page}
            onPageChange={setPage}
            onAddPhotos={addPhotos}
            renderPhoto={(photo, index, size) => {
              const imageWidth =
                photo.width && photo.height
                  ? Math.min(size.width, (size.height * photo.width) / photo.height)
                  : size.width;
              return (
                <View style={size}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${photo.kind} photo ${index + 1}`}
                    onPress={() =>
                      router.push({
                        pathname: "/photo-details",
                        params: { savedId: work.localId, photoId: photo.localId },
                      })
                    }
                    style={size}
                  >
                    {photo.path && !failedPhotos[photo.path] ? (
                      <LoadingImage
                        uri={captureFileUri(photo.path)}
                        label={`${photo.kind} photo ${index + 1} of ${work.title}`}
                        onLoad={({ source: { width, height } }) =>
                          setPhotoSizes((previous) =>
                            previous[photo.path!]?.width === width && previous[photo.path!]?.height === height
                              ? previous
                              : { ...previous, [photo.path!]: { width, height } },
                          )
                        }
                        onError={() => setFailedPhotos((previous) => ({ ...previous, [photo.path!]: true }))}
                        style={size}
                        contentFit="contain"
                      />
                    ) : (
                      <View style={[size, styles.unavailable]}>
                        <Text style={styles.secondary}>
                          {photo.path
                            ? `Image unavailable · ${work.title}`
                            : `Photo unavailable on this iPhone · ${work.title}`}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                  {index === page && photo.kind !== "label" && !!photo.path && !failedPhotos[photo.path] && (
                    <View style={[styles.cropAction, { right: (size.width - imageWidth) / 2 + 8 }]}>
                      <GalleryButton
                        label={`Adjust crop for ${photo.kind} photo ${index + 1}`}
                        icon="crop"
                        iconOnly
                        tone="ink"
                        fullWidth={false}
                        cornerRadius={Radius.full}
                        onPress={() =>
                          router.push({
                            pathname: "/adjust-crop",
                            params: { savedId: work.localId, photoId: photo.localId },
                          })
                        }
                      />
                    </View>
                  )}
                </View>
              );
            }}
            renderThumbnail={(photo, index) =>
              photo.path && !failedPhotos[photo.path] ? (
                <LoadingImage
                  uri={captureFileUri(photo.path)}
                  label={`${photo.kind} thumbnail ${index + 1}`}
                  contentFit="cover"
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <View style={[{ flex: 1 }, styles.unavailable]}>
                  <Image source="sf:photo" tintColor={Gallery.muted} style={{ width: 22, height: 22 }} />
                </View>
              )
            }
          />
        </View>
      )}
      <View style={{ gap: 4 }}>
        <Text variant="display" accessibilityRole="header" selectable>
          {work.title}
        </Text>
        <Text selectable style={styles.title}>
          {work.artist || "Artist unknown"}
          {work.date ? `, ${work.date}` : ""}
        </Text>
        {!!work.medium && (
          <Text selectable style={styles.medium}>
            {work.medium}
          </Text>
        )}
        {!!museum && (
          <View style={styles.museum}>
            <Image
              source="sf:building.columns"
              tintColor={Gallery.muted}
              style={styles.museumIcon}
              accessible={false}
            />
            <Text selectable style={[styles.medium, { flexShrink: 1 }]}>
              {museum}
            </Text>
          </View>
        )}
      </View>
      {children}
      {rows.length === 0 && !!photos.updatedAt && !photos.error && (
        <EmptyState
          inset={false}
          title={scope === "visit" ? "No photos from this visit yet." : "No photos yet."}
          detail={
            scope === "visit"
              ? "Add a photo from this visit, or look through the rest of this artwork’s photos."
              : "Add photos of the artwork, its details, or its wall label."
          }
        >
          <ActionStack
            textActions={
              scope === "visit" && (
                <GalleryButton
                  label="View all photos"
                  onPress={() => {
                    setScope("all");
                    setPage(0);
                  }}
                />
              )
            }
          >
            <GalleryButton label="Add photos" variant="filled" fullWidth onPress={addPhotos} />
          </ActionStack>
        </EmptyState>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  cropAction: {
    position: "absolute",
    bottom: 8,
    borderRadius: Radius.full,
    backgroundColor: Gallery.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.separator,
  },
  unavailable: { backgroundColor: Gallery.fill, alignItems: "center", justifyContent: "center", padding: 8 },
  secondary: { color: Gallery.muted, fontSize: 13, lineHeight: 18 },
  title: {
    fontSize: 18,
    lineHeight: 22,
    color: Gallery.ink,
    fontWeight: "500",
  },
  medium: { fontSize: 15, lineHeight: 22, color: Gallery.muted },
  museum: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  // Centers the icon on the first text line so it stays put when a long name wraps.
  museumIcon: { width: 15, height: 15, marginTop: 3.5 },
});
