import { useEffect } from "react";
import { reportError } from "@/lib/observability";
import { PhotoStripSkeleton, TextSkeleton } from "@/components/loading-skeleton";
import { LoadingImage } from "@/components/loading-image";
import { ThemedText as Text } from "@/components/themed-text";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";
import { Image } from "expo-image";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { Gallery } from "@/constants/theme";
import { selectArtworkPhotos } from "@/db/repos/artwork-album";
import { listVisits } from "@/db/repos/visits";
import { formatVisitDate } from "@/lib/journal/history";
import { useLocalOwner } from "@/lib/account/owner-store";
import { captureFileUri } from "@/lib/files/photos";

export function WallPhotoPicker({
  savedId,
  selectedId,
  onSelect,
  compact = false,
}: {
  savedId: string;
  selectedId?: string;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const owner = useLocalOwner();
  const { fontScale } = useWindowDimensions();
  const { data, updatedAt, error } = useLiveQuery(selectArtworkPhotos(savedId, owner), [
    savedId,
    owner,
  ]);
  const visits = useLiveQuery(listVisits(owner), [owner]);
  const queryError = error ?? visits.error;
  useEffect(() => {
    if (queryError) reportError(queryError, "wall.photo-picker.load");
  }, [queryError]);
  const photos = data.filter((photo) => photo.owner === owner);
  const selected = photos.find((photo) => photo.localId === selectedId);
  const selectedVisit = visits.data.find(
    (visit) => visit.owner === owner && visit.localId === selected?.visitLocalId,
  );
  if (error)
    return (
      <Text accessibilityRole="alert" style={{ color: Gallery.destructive }}>
        Photos could not load. Reopen the photo picker to try again.
      </Text>
    );
  if (!updatedAt && !photos.length) return <PhotoStripSkeleton />;
  return (
    <View style={{ gap: 4 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingVertical: 4 }}
      >
        {photos.map((photo, index) => {
          const visit = visits.data.find(
            (visit) => visit.owner === owner && visit.localId === photo.visitLocalId,
          );
          const kind =
            photo.kind === "full"
              ? "Full painting"
              : photo.kind === "detail"
                ? "Detail"
                : "Wall label";
          return (
            <Pressable
              key={photo.localId}
              accessibilityRole="button"
              accessibilityLabel={`Use ${photo.kind} photo ${index + 1} on wall`}
              accessibilityHint={[
                photo.caption,
                kind,
                visit
                  ? formatVisitDate(visit.visitedOn)
                  : visits.updatedAt
                    ? "Not linked to a visit"
                    : "",
              ]
                .filter(Boolean)
                .join(" · ")}
              accessibilityState={{ selected: photo.localId === selectedId }}
              onPress={() => onSelect(photo.localId)}
              style={{
                width: (compact ? 112 : 116) * fontScale,
                padding: 4,
                gap: 6,
                borderWidth: 2,
                borderColor: photo.localId === selectedId ? Gallery.accent : "transparent",
                backgroundColor: Gallery.paper,
                borderRadius: 2,
              }}
            >
              <View
                style={{
                  width: "100%",
                  aspectRatio: compact ? 1.6 : 1,
                  backgroundColor: Gallery.fill,
                }}
              >
                {photo.path && (
                  <LoadingImage
                    uri={captureFileUri(photo.path)}
                    label={`${kind} photo ${index + 1}`}
                    style={{ width: "100%", height: "100%" }}
                    contentFit="contain"
                  />
                )}
              </View>
              {!compact && (
                <>
                  <Text
                    style={{ color: Gallery.ink, fontSize: 15, lineHeight: 22, fontWeight: "500" }}
                  >
                    {photo.caption || kind}
                    {photo.localId === selectedId ? " ✓" : ""}
                  </Text>
                  {!visits.updatedAt && !visits.error ? (
                    <TextSkeleton label="Loading photo visit" width="80%" />
                  ) : (
                    <Text style={{ color: Gallery.muted, fontSize: 13, lineHeight: 18 }}>
                      {visits.error
                        ? "Visit unavailable"
                        : visit
                          ? formatVisitDate(visit.visitedOn)
                          : "Not linked to a visit"}{" "}
                      · {kind}
                    </Text>
                  )}
                </>
              )}
              {compact && photo.localId === selectedId && (
                <Image
                  source="sf:checkmark.circle.fill"
                  tintColor={Gallery.accent}
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
                    width: 19,
                    height: 19,
                    backgroundColor: Gallery.paper,
                    borderRadius: 10,
                  }}
                />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      {compact && selected && (
        <Text style={{ color: Gallery.muted, fontSize: 13, lineHeight: 18 }}>
          {selected.caption ||
            (selected.kind === "full"
              ? "Full painting"
              : selected.kind === "detail"
                ? "Detail"
                : "Wall label")}
          {selectedVisit ? ` · ${formatVisitDate(selectedVisit.visitedOn)}` : ""}
        </Text>
      )}
    </View>
  );
}
