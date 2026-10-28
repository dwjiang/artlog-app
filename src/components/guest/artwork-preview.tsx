import { Image } from "expo-image";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { Gallery, Spacing } from "@/constants/theme";
import { useSafeAreaWidth } from "@/lib/ui/safe-area";

export const introArtworks = {
  pearl: {
    source: require("../../../assets/images/onboarding/girl-with-a-pearl-earring.webp"),
    title: "Girl with a Pearl Earring, Johannes Vermeer",
    aspectRatio: 1600 / 1895,
  },
  lilies: {
    source: require("../../../assets/images/onboarding/water-lilies.webp"),
    title: "Water Lilies, Claude Monet",
    aspectRatio: 1686 / 1619,
  },
  stars: {
    source: require("../../../assets/images/onboarding/starry-night.webp"),
    title: "The Starry Night, Vincent van Gogh",
    aspectRatio: 1920 / 1520,
  },
} as const;

export function ArtworkCollage() {
  const { height, fontScale } = useWindowDimensions();
  const width = useSafeAreaWidth();
  const size = Math.min(width - Spacing.content * 2, height < 760 || fontScale > 1.3 ? 280 : 360);
  const prints = [
    {
      artwork: introArtworks.pearl,
      left: 0.02,
      top: 0.08,
      width: 0.43,
      height: 0.51,
      rotate: "-9deg",
    },
    {
      artwork: introArtworks.stars,
      left: 0.55,
      top: 0.06,
      width: 0.43,
      height: 0.51,
      rotate: "9deg",
    },
    {
      artwork: introArtworks.lilies,
      left: 0.28,
      top: 0.19,
      width: 0.44,
      height: 0.44,
      rotate: "0deg",
    },
  ];
  return (
    <View style={styles.center}>
      <View accessibilityElementsHidden style={{ width: size, height: size * 0.68 }}>
        {prints.map(({ artwork, left, top, width: printWidth, height: printHeight, rotate }) => (
          <View
            key={artwork.title}
            style={[
              styles.print,
              {
                left: left * size,
                top: top * size,
                width: printWidth * size,
                height: printHeight * size,
                transform: [{ rotate }],
              },
            ]}
          >
            <Image source={artwork.source} contentFit="cover" style={styles.image} accessible={false} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center" },
  print: {
    position: "absolute",
    padding: 5,
    backgroundColor: Gallery.surface,
    boxShadow: "0 4px 10px rgba(17,17,17,0.16)",
  },
  image: { width: "100%", height: "100%" },
});
