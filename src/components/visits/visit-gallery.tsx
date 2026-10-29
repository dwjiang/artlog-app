import { Image } from "expo-image";
import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { SavedWorkImage } from "@/components/collection/saved-work-image";
import { SearchField } from "@/components/search-field";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { useSafeAreaWidth } from "@/lib/ui/safe-area";
import { normalizeSearch } from "@/shared/journal/limits";

const STAGE_ASPECT = 1.04;

export function matchesVisitSearch(work: { title: string; artist: string | null }, query: string) {
  return normalizeSearch(`${work.title} ${work.artist ?? ""}`).includes(normalizeSearch(query));
}

export function VisitGallerySearch({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) {
  return (
    <SearchField
      label="Search visit artworks"
      placeholder="Search this visit"
      value={value}
      showLabel={false}
      onChange={onChangeText}
      onClear={() => onChangeText("")}
      style={styles.search}
    />
  );
}

export function VisitGalleryArtwork({
  title,
  artist,
  photoCount,
  aspectRatio = 1,
  children,
}: {
  title: string;
  artist: string | null;
  photoCount: number;
  aspectRatio?: number;
  children: (imageWidth: number) => ReactNode;
}) {
  const width = useSafeAreaWidth();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const stageWidth = measuredWidth || Math.max(1, (width - 53) / 2);
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const frameWidth = Math.max(stageWidth, (stageWidth / STAGE_ASPECT) * ratio);
  return (
    <>
      <View style={styles.stage} onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}>
        <View style={{ width: frameWidth }}>{children(frameWidth)}</View>
        {photoCount !== 1 && (
          <View style={styles.badge}>
            {photoCount > 1 && (
              <Image source="sf:photo.on.rectangle" tintColor={Gallery.muted} style={{ width: 11, height: 11 }} />
            )}
            <Text style={styles.badgeText}>{photoCount ? `${photoCount} photos` : "No photos"}</Text>
          </View>
        )}
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.artist}>{artist || "Artist unknown"}</Text>
    </>
  );
}

export function LocalVisitGalleryArtwork({
  title,
  artist,
  photoCount,
  path,
  syncing = false,
}: {
  title: string;
  artist: string | null;
  photoCount: number;
  path: string | null;
  syncing?: boolean;
}) {
  const [image, setImage] = useState<{ path: string | null; ratio: number }>();
  const ratio = image?.path === path ? image.ratio : 1;
  return (
    <VisitGalleryArtwork title={title} artist={artist} photoCount={photoCount} aspectRatio={ratio}>
      {(width) => (
        <SavedWorkImage
          contain
          path={path}
          syncing={syncing}
          title={title}
          style={{ width, aspectRatio: ratio }}
          onLoad={({ width: imageWidth, height }) => setImage({ path, ratio: imageWidth / height })}
        />
      )}
    </VisitGalleryArtwork>
  );
}

const styles = StyleSheet.create({
  search: {
    marginTop: 5,
    marginBottom: 13,
  },
  stage: {
    aspectRatio: STAGE_ASPECT,
    width: "100%",
    borderRadius: 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: Gallery.paper,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  title: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
    color: Gallery.ink,
    marginTop: 6,
    marginHorizontal: 1,
  },
  artist: {
    fontSize: 13,
    lineHeight: 18,
    color: Gallery.muted,
    marginTop: 2,
    marginHorizontal: 1,
  },
});
