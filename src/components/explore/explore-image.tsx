import { Image, type ImageContentPosition } from "expo-image";
import { useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, FadeIn, ReduceMotion } from "react-native-reanimated";

import { GlassSurface } from "@/components/glass-surface";
import { LoadingImage } from "@/components/loading-image";
import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Motion, Radius } from "@/constants/theme";
import type { Exhibition } from "@/lib/explore/types";

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
          onLoad={() => setLoadedUri(image.uri)}
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

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
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
