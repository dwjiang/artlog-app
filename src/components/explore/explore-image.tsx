import { Image } from "expo-image";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { LoadingImage } from "@/components/loading-image";
import { Gallery } from "@/constants/theme";
import type { Exhibition } from "@/lib/explore/types";

/** A show's artwork, or a neutral tile with `icon` when none is listed. */
export function ExploreImage({
  image,
  icon = "photo.artframe",
  style,
}: {
  image: Exhibition["image"];
  icon?: string;
  style: StyleProp<ViewStyle>;
}) {
  if (image) return <LoadingImage uri={image.uri} label={image.label} style={style} />;
  return (
    <View style={[styles.placeholder, style]}>
      <Image source={`sf:${icon}`} tintColor={Gallery.muted} accessible={false} style={styles.icon} />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: Gallery.fill, alignItems: "center", justifyContent: "center" },
  icon: { width: 28, height: 28 },
});
