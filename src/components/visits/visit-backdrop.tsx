import { Image } from "expo-image";
import { StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";

import { SavedWorkImage } from "@/components/collection/saved-work-image";
import { Gallery } from "@/constants/theme";

type VisitWork = { cropPath: string | null; title: string };

/** The newest saved artwork that has a photo. */
export function newestPhoto<T extends VisitWork>(works: T[]): T | undefined {
  return works.find((work) => work.cropPath);
}

/**
 * Fills its parent with an open visit's backdrop: the newest saved artwork that has a photo, under `scrim`, or the blue
 * museum gradient and watermark until one is saved. A save without a photo keeps the gradient rather than a placeholder.
 */
export function VisitBackdrop({
  works,
  scrim,
  watermark,
  blurRadius,
}: {
  works: VisitWork[];
  scrim: StyleProp<ViewStyle>;
  watermark: StyleProp<ImageStyle>;
  blurRadius?: number;
}) {
  const hero = newestPhoto(works);
  if (!hero) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.blue]}>
        <Image source="sf:building.columns.fill" tintColor={WATERMARK} style={[styles.watermark, watermark]} />
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

const WATERMARK = "rgba(255, 255, 255, 0.14)";

const styles = StyleSheet.create({
  blue: {
    backgroundColor: Gallery.accent,
    experimental_backgroundImage: "linear-gradient(150deg, #3A63E0 0%, #254FD4 45%, #1C3DA8 100%)",
  },
  watermark: { position: "absolute" },
  photo: { borderRadius: 0 },
});
