import { useEffect, useRef, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

type Photo = { id: string; label: string; width?: number; height?: number };

export function PhotoGallery<T extends Photo>({
  photos,
  page,
  onPageChange,
  renderPhoto,
  renderThumbnail,
  onAddPhotos,
}: {
  photos: T[];
  page: number;
  onPageChange: (page: number) => void;
  renderPhoto: (photo: T, index: number, size: { width: number; height: number }) => ReactNode;
  renderThumbnail: (photo: T, index: number) => ReactNode;
  onAddPhotos?: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const gallery = useRef<ScrollView>(null);
  const filmstrip = useRef<ScrollView>(null);
  const reduceMotion = useReducedMotion();
  const selected = Math.max(0, Math.min(photos.length - 1, page));
  const photo = photos[selected];
  const aspectRatio = photo?.width && photo?.height ? photo.width / photo.height : 0;
  const maxImageHeight = Math.min(width * 1.2, height * 0.52);
  const imageHeight =
    Number.isFinite(aspectRatio) && aspectRatio > 0
      ? Math.min((width - 40) / aspectRatio, maxImageHeight)
      : maxImageHeight;
  const filmstripOffset = Math.max(0, selected * 48 - (width - 40 - 44) / 2);

  useEffect(() => {
    gallery.current?.scrollTo({ x: selected * width, animated: !reduceMotion });
    filmstrip.current?.scrollTo({ x: filmstripOffset, animated: !reduceMotion });
  }, [selected, width, filmstripOffset, reduceMotion]);

  return (
    <View style={{ gap: 8 }}>
      <ScrollView
        ref={gallery}
        horizontal
        pagingEnabled
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        accessibilityLabel="Artwork photos"
        onContentSizeChange={() => gallery.current?.scrollTo({ x: selected * width, animated: false })}
        onMomentumScrollEnd={({ nativeEvent }) =>
          onPageChange(Math.max(0, Math.min(photos.length - 1, Math.round(nativeEvent.contentOffset.x / width))))
        }
        style={{ height: imageHeight }}
      >
        {photos.map((photo, index) => (
          <View key={photo.id} style={{ width, height: imageHeight, paddingHorizontal: 20 }}>
            {renderPhoto(photo, index, { width: width - 40, height: imageHeight })}
          </View>
        ))}
      </ScrollView>
      {(photos.length > 1 || onAddPhotos) && (
        <View style={styles.controls}>
          <ScrollView
            ref={filmstrip}
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityLabel="Photo thumbnails"
            contentContainerStyle={styles.filmstrip}
            onContentSizeChange={() => filmstrip.current?.scrollTo({ x: filmstripOffset, animated: false })}
          >
            {photos.map((photo, index) => (
              <Pressable
                key={photo.id}
                accessibilityRole="button"
                accessibilityLabel={`Show ${photo.label}`}
                accessibilityValue={{ text: `${index + 1} of ${photos.length}` }}
                accessibilityState={{ selected: index === selected }}
                onPress={() => onPageChange(index)}
                style={[styles.thumbnail, index === selected && styles.selectedThumbnail]}
              >
                <View pointerEvents="none" accessible={false} accessibilityElementsHidden style={styles.thumbnailImage}>
                  {renderThumbnail(photo, index)}
                </View>
              </Pressable>
            ))}
            {onAddPhotos && (
              <View style={styles.addPhoto}>
                <GalleryButton
                  label="Add photos"
                  icon="plus"
                  iconOnly
                  fullWidth={false}
                  minHeight={52}
                  onPress={onAddPhotos}
                />
              </View>
            )}
          </ScrollView>
          {photos.length > 1 && (
            <Text accessibilityLiveRegion="polite" style={styles.counter}>
              {selected + 1} / {photos.length}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { gap: 4, paddingHorizontal: 20 },
  filmstrip: { flexGrow: 1, justifyContent: "center", gap: 4 },
  thumbnail: {
    width: 44,
    height: 52,
    padding: 2,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: 4,
  },
  selectedThumbnail: { borderColor: Gallery.accent },
  thumbnailImage: { flex: 1, overflow: "hidden", borderRadius: 2 },
  addPhoto: { width: 44, marginLeft: 4, borderRadius: 4, backgroundColor: Gallery.fill },
  counter: { color: Gallery.muted, fontSize: 13, lineHeight: 18, textAlign: "center", fontVariant: ["tabular-nums"] },
});
