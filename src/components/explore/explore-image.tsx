import { Image, type ImageContentPosition } from "expo-image";
import { useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, FadeIn, ReduceMotion } from "react-native-reanimated";

import { GlassSurface } from "@/components/glass-surface";
import { LoadingImage } from "@/components/loading-image";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Motion, Radius } from "@/constants/theme";
import type { Exhibition } from "@/lib/explore/types";
import { knownImageSize, rememberImageSize } from "@/lib/ui/image-sizes";

/** Link-preview images are made for 1.91:1 cards, so a show's picture takes that shape until its own is known. */
export const LINK_PREVIEW_ASPECT = 1.91;

// The credit fades in with its picture, so it never sits over a loading or failed one; a fade, so it stays with Reduce
// Motion on.
const REVEAL = FadeIn.duration(Motion.state)
  .easing(Easing.bezier(...Motion.easeOut))
  .reduceMotion(ReduceMotion.Never);

/** A show's artwork, or a neutral tile with `icon` when none is listed. A `credit` sits in a pill in its lower corner. */
export function ExploreImage({
  image,
  icon = "photo.artframe",
  credit = "",
  style,
}: {
  image: (Exhibition["image"] & { contentPosition?: ImageContentPosition }) | undefined;
  icon?: string;
  credit?: string;
  style: StyleProp<ViewStyle>;
}) {
  const [loadedUri, setLoadedUri] = useState<string>();
  if (image) {
    return (
      <View style={[styles.clip, style]}>
        <LoadingImage
          uri={image.uri}
          label={image.label}
          contentPosition={image.contentPosition}
          onLoad={({ source }) => {
            // A show's page sizes its picture from this before loading it again.
            rememberImageSize(image.uri, source);
            setLoadedUri(image.uri);
          }}
          style={StyleSheet.absoluteFill}
        />
        {credit !== "" && loadedUri === image.uri && (
          <Animated.View entering={REVEAL} style={styles.credit}>
            <GlassSurface style={styles.pill}>
              <Image source="sf:camera.fill" tintColor={Gallery.paper} accessible={false} style={styles.camera} />
              {/* Truncating the middle keeps a long author's licence in view. */}
              <Text numberOfLines={1} ellipsizeMode="middle" style={styles.creditText}>
                {credit}
              </Text>
            </GlassSurface>
          </Animated.View>
        )}
      </View>
    );
  }
  return (
    <View style={[styles.placeholder, style]}>
      <Image source={`sf:${icon}`} tintColor={Gallery.muted} accessible={false} style={styles.icon} />
    </View>
  );
}

type HeaderPhotoProps = { uri: string; label: string; width: number; fallbackAspect: number };
type Size = { width: number; height: number };

/**
 * A page's header picture, `width` wide. Its box opens in the picture's shape when this session has already loaded it,
 * else in `fallbackAspect`, and keeps that shape, so the page never moves under it. A picture of another shape shows
 * whole inside the box, with its rounded corners on the picture's own edges.
 */
export function HeaderPhoto(props: HeaderPhotoProps) {
  return <HeaderPhotoContent key={props.uri} {...props} />;
}

function HeaderPhotoContent({ uri, label, width, fallbackAspect }: HeaderPhotoProps) {
  const [boxAspect] = useState(() => {
    const known = knownImageSize(uri);
    return known ? known.width / known.height : fallbackAspect;
  });
  const [pictureAspect, setPictureAspect] = useState(boxAspect);
  const box = { width, height: width / boxAspect };
  return (
    <View style={[styles.header, box]}>
      <View style={[styles.headerClip, containedSize(box, pictureAspect)]}>
        {/* Sized to the box rather than the clip: expo-image loads its picture again whenever its view is resized. */}
        <LoadingImage
          uri={uri}
          label={label}
          contentFit="contain"
          onLoad={({ source }) => {
            rememberImageSize(uri, source);
            if (source.width > 0 && source.height > 0) setPictureAspect(source.width / source.height);
          }}
          style={box}
        />
      </View>
    </View>
  );
}

const containedSize = (box: Size, aspect: number): Size =>
  aspect > box.width / box.height
    ? { width: box.width, height: box.width / aspect }
    : { width: box.height * aspect, height: box.height };

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  header: { alignItems: "center", justifyContent: "center" },
  // Centring the box-sized picture in a smaller clip leaves it overflowing evenly on both sides.
  headerClip: { borderRadius: Radius.card, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  credit: { position: "absolute", left: 8, right: 8, bottom: 8, alignItems: "flex-start" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
    paddingVertical: 3,
    paddingLeft: 7,
    paddingRight: 8,
    borderRadius: Radius.full,
    overflow: "hidden",
  },
  camera: { width: 11, height: 9 },
  creditText: { flexShrink: 1, fontSize: 11, lineHeight: 14, fontWeight: "500", color: Gallery.paper },
  placeholder: { backgroundColor: Gallery.fill, alignItems: "center", justifyContent: "center" },
  icon: { width: 28, height: 28 },
});
