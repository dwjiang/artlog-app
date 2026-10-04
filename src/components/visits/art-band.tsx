import { Image } from "expo-image";
import type { ReactElement, ReactNode } from "react";
import { FlatList, StyleSheet, View, useWindowDimensions } from "react-native";

import { wallpaperStyle } from "@/components/collection/wallpaper";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { Colors, Gallery, Spacing } from "@/constants/theme";
import { isLightWall, type Wallpaper } from "@/lib/wall/wall-layout";

const ART_HEIGHT = 200;
const MIN_PIECE_WIDTH = 120;

export type BandArtwork = {
  key: string;
  title: string;
  artist: string | null;
  /** Width over height; a local photo's is unknown until it loads. */
  aspect?: number;
  photoCount?: number;
  onPress?: () => void;
  renderImage: (size: { width: number; height: number }) => ReactNode;
};

/** A visit's artworks hung in one row on its wallpaper, with wall labels; the row scrolls sideways. */
export function ArtBand({
  wallpaper,
  artworks,
  accessory,
  footer,
  onEndReached,
}: {
  wallpaper: Wallpaper;
  artworks: BandArtwork[];
  accessory?: ReactNode;
  footer?: ReactElement;
  onEndReached?: () => void;
}) {
  const { width } = useWindowDimensions();
  const labelColor = isLightWall(wallpaper.color) ? Gallery.ink : Gallery.paper;
  // A wide artwork stops short of the screen edge so the next one still peeks in.
  const maxWidth = width - 2 * Spacing.content - 48;
  return (
    <View style={wallpaperStyle(wallpaper)}>
      <FlatList
        testID="art-band"
        horizontal
        data={artworks}
        keyExtractor={(artwork) => artwork.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.track}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={footer}
        ListFooterComponentStyle={styles.footer}
        renderItem={({ item }) => <BandPiece artwork={item} maxWidth={maxWidth} labelColor={labelColor} />}
      />
      {accessory}
    </View>
  );
}

function BandPiece({ artwork, maxWidth, labelColor }: { artwork: BandArtwork; maxWidth: number; labelColor: string }) {
  const { title, onPress, photoCount = 1 } = artwork;
  const artist = artwork.artist || "Artist unknown";
  const photos = photoCount > 1 ? `, ${photoCount} photos` : "";
  const ratio = artwork.aspect && Number.isFinite(artwork.aspect) && artwork.aspect > 0 ? artwork.aspect : 1;
  const width = Math.min(ART_HEIGHT * ratio, maxWidth);
  const size = { width, height: width / ratio };
  const style = { width: Math.max(width, MIN_PIECE_WIDTH) };
  const content = (
    <>
      <View style={styles.hanging}>
        <View style={[styles.print, size]}>
          {artwork.renderImage(size)}
          {photoCount > 1 && (
            <View style={styles.stack}>
              <Image
                source="sf:square.fill.on.square.fill"
                tintColor={Colors.light.overlayText}
                style={styles.stackSymbol}
                accessible={false}
              />
            </View>
          )}
        </View>
      </View>
      <View style={styles.label}>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={[styles.artist, { color: labelColor }]}>
          {artist}
        </Text>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={[styles.title, { color: labelColor }]}>
          {title}
        </Text>
      </View>
    </>
  );
  return onPress ? (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={`View ${title}${photos}`}
      accessibilityHint={artist}
      style={style}
      onPress={onPress}
    >
      {content}
    </MotionPressable>
  ) : (
    <View accessible accessibilityLabel={`${title}, ${artist}${photos}`} style={style}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { gap: 28, paddingHorizontal: Spacing.content, paddingTop: 28, paddingBottom: 20 },
  footer: { height: ART_HEIGHT, justifyContent: "center" },
  hanging: { height: ART_HEIGHT, justifyContent: "center" },
  print: {
    boxShadow: [
      { offsetX: 1, offsetY: 2, blurRadius: 2, color: "rgba(27,20,12,0.22)" },
      { offsetX: 2, offsetY: 5, blurRadius: 7, color: "rgba(27,20,12,0.18)" },
    ],
  },
  stack: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.light.overlayScrim,
  },
  stackSymbol: { width: 12, height: 12 },
  label: { marginTop: 12, gap: 2 },
  artist: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  title: { fontSize: 12, lineHeight: 16 },
});
