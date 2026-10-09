import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";

import { SavedWorkImage } from "@/components/collection/saved-work-image";
import { Gallery, Motion } from "@/constants/theme";
import type { MuseumPhoto } from "@/lib/venue/use-museum-photo";

type VisitWork = { cropPath: string | null; title: string };

/** The newest saved artwork that has a photo. */
export function newestPhoto<T extends VisitWork>(works: T[]): T | undefined {
  return works.find((work) => work.cropPath);
}

/**
 * Fills its parent with a visit's backdrop: the newest saved artwork that has a photo, else the museum's photo, under
 * `scrim`. Until either shows, the blue museum gradient and watermark; a save without a photo keeps them rather than a
 * placeholder.
 */
export function VisitBackdrop({
  works,
  museumPhoto,
  scrim,
  watermark,
  blurRadius,
}: {
  works: VisitWork[];
  museumPhoto?: MuseumPhoto;
  scrim: StyleProp<ViewStyle>;
  watermark: StyleProp<ImageStyle>;
  blurRadius?: number;
}) {
  const hero = newestPhoto(works);
  if (!hero) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.blue]}>
        <Image source="sf:building.columns.fill" tintColor={WATERMARK} style={[styles.watermark, watermark]} />
        {museumPhoto && (
          <MuseumPhotoLayer
            key={museumPhoto.imageUrl}
            uri={museumPhoto.imageUrl}
            scrim={scrim}
            blurRadius={blurRadius}
          />
        )}
      </View>
    );
  }
  return (
    <>
      <SavedWorkImage
        path={hero.cropPath}
        title={hero.title}
        blurRadius={blurRadius}
        style={[StyleSheet.absoluteFill, styles.photo]}
      />
      <View style={[StyleSheet.absoluteFill, scrim]} />
    </>
  );
}

/** The museum's photo and its scrim, faded in together over the blue card once the photo shows; never if it cannot. */
function MuseumPhotoLayer({
  uri,
  scrim,
  blurRadius,
}: {
  uri: string;
  scrim: StyleProp<ViewStyle>;
  blurRadius?: number;
}) {
  const [shown, setShown] = useState(false);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: shown ? 1 : 0 }, FADE]}>
      <Image
        source={uri}
        accessible={false}
        blurRadius={blurRadius}
        style={StyleSheet.absoluteFill}
        onDisplay={() => setShown(true)}
      />
      <View style={[StyleSheet.absoluteFill, scrim]} />
    </Animated.View>
  );
}

const WATERMARK = "rgba(255, 255, 255, 0.14)";
const FADE = {
  transitionProperty: "opacity",
  transitionDuration: Motion.state,
  transitionTimingFunction: cubicBezier(...Motion.easeOut),
} as const;

const styles = StyleSheet.create({
  blue: {
    backgroundColor: Gallery.accent,
    experimental_backgroundImage: "linear-gradient(150deg, #3A63E0 0%, #254FD4 45%, #1C3DA8 100%)",
  },
  watermark: { position: "absolute" },
  photo: { borderRadius: 0 },
});
