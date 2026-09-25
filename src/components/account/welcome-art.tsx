import { Image } from "expo-image";
import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { FadeInDown, useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { WallFrame } from "@/components/collection/wall-frame";
import { introArtworks } from "@/components/guest/artwork-preview";
import { Gallery } from "@/constants/theme";
import type { WallFrame as Frame } from "@/lib/wall/wall-layout";

type Artwork = (typeof introArtworks)[keyof typeof introArtworks];
type ArtProps = {
  size: number;
  /** 0 while the page is centered, ±1 one page away; drives the parallax. */
  progress: SharedValue<number>;
};

export const welcomeWall = "#6C2F2B";

/** The salon wall behind the brand statement: three framed prints with a parallax swipe. */
export function WelcomeArt({ size, progress }: ArtProps) {
  const layers = [
    { artwork: introArtworks.lilies, frame: "walnut", left: 0.02, top: 0.34, width: 0.23, depth: 0.22 },
    { artwork: introArtworks.stars, frame: "mat", left: 0.75, top: 0.37, width: 0.23, depth: 0.22 },
    { artwork: introArtworks.pearl, frame: "gilt", left: 0.28, top: 0.18, width: 0.44, depth: 0.1 },
  ] as const;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <View style={[styles.floor, { top: size * 0.9, left: -size, width: size * 3 }]} />
      {layers.map(({ artwork, frame, left, top, width, depth }, index) => (
        <Layer key={artwork.title} progress={progress} size={size} depth={depth} style={at(size, left, top)}>
          <Animated.View
            entering={FadeInDown.delay(250 + index * 90)
              .springify()
              .damping(18)}
          >
            <Framed artwork={artwork} frame={frame} width={width * size} />
          </Animated.View>
        </Layer>
      ))}
      <Layer progress={progress} size={size} depth={0.3} style={at(size, 0.75, 0.6)}>
        <Animated.View entering={FadeInDown.delay(520).springify().damping(18)}>
          <WallLabel size={size} />
        </Animated.View>
      </Layer>
    </View>
  );
}

function Layer({
  progress,
  size,
  depth,
  style,
  children,
}: ArtProps & { depth: number; style: ViewStyle; children: ReactNode }) {
  // Nearer layers travel farther than the page, so the wall reads as depth while swiping.
  const parallax = useAnimatedStyle(() => ({ transform: [{ translateX: -progress.get() * depth * size }] }));
  return <Animated.View style={[styles.layer, style, parallax]}>{children}</Animated.View>;
}

function Framed({ artwork, frame, width }: { artwork: Artwork; frame: Frame; width: number }) {
  return (
    <WallFrame frame={frame} width={width}>
      <Image
        source={artwork.source}
        contentFit="cover"
        accessible={false}
        style={{ width: "100%", aspectRatio: artwork.aspectRatio }}
      />
    </WallFrame>
  );
}

function WallLabel({ size }: { size: number }) {
  return (
    <View style={[styles.wallLabel, { width: size * 0.12, padding: size * 0.014, gap: size * 0.01 }]}>
      {[1, 0.7, 0.85].map((width, index) => (
        <View
          key={index}
          style={{
            width: `${width * 100}%`,
            height: size * (index === 0 ? 0.01 : 0.006),
            backgroundColor: index === 0 ? Gallery.ink : Gallery.controlBorder,
          }}
        />
      ))}
    </View>
  );
}

function at(size: number, left: number, top: number): ViewStyle {
  return { left: left * size, top: top * size };
}

const styles = StyleSheet.create({
  layer: { position: "absolute" },
  floor: { position: "absolute", bottom: -1000, backgroundColor: "rgba(17,17,17,0.14)" },
  wallLabel: { backgroundColor: Gallery.surface, boxShadow: "0 1px 3px rgba(0,0,0,0.25)" },
});
