import { Image, type ImageProps } from "expo-image";
import { useEffect, useRef, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Colors } from "@/constants/theme";
import { interpolateCorners, perspectiveMatrix, type RevealGeometry } from "@/lib/capture/reveal-geometry";

export const HIGHLIGHT_MS = 150;
export const STRAIGHTEN_MS = 650;
export const CROSSFADE_MS = 150;
export const SHINE_DELAY_MS = 350;
export const SHINE_MS = 950;
const LIFTED_BLUR = 12;

/**
 * The scanned painting lifting out of its photograph: outlined, straightened onto a blurred, washed copy of the
 * photograph, then swept by a shine. It plays once `playing` turns on. `background` draws the photograph, blurred by
 * the given radius for the lifted copy.
 */
export function PaintingReveal({
  geometry,
  crop,
  playing,
  background,
  onCropDisplay,
  onError,
  onFinish,
}: {
  geometry: RevealGeometry | null;
  crop: ImageProps["source"];
  playing: boolean;
  background: (blurRadius?: number) => ReactNode;
  onCropDisplay?: () => void;
  onError?: () => void;
  onFinish?: () => void;
}) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const highlight = useSharedValue(0);
  const shine = useSharedValue(0);
  const finished = useRef(onFinish);
  useEffect(() => {
    finished.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    if (!playing || !geometry) return;
    const finish = () => finished.current?.();
    highlight.set(withTiming(1, { duration: reduced ? 0 : HIGHLIGHT_MS }));
    progress.set(
      withDelay(
        reduced ? 0 : HIGHLIGHT_MS,
        withTiming(
          1,
          {
            duration: reduced ? CROSSFADE_MS : STRAIGHTEN_MS,
            easing: Easing.bezier(0.77, 0, 0.175, 1),
            reduceMotion: ReduceMotion.Never,
          },
          (done) => {
            if (done && reduced) scheduleOnRN(finish);
          },
        ),
      ),
    );
    if (!reduced) {
      shine.set(
        withDelay(
          HIGHLIGHT_MS + SHINE_DELAY_MS,
          withTiming(
            1,
            {
              duration: SHINE_MS,
              easing: Easing.bezier(0.2, 0, 0.45, 1),
            },
            (done) => {
              if (done) scheduleOnRN(finish);
            },
          ),
        ),
      );
    }
    return () => {
      cancelAnimation(progress);
      cancelAnimation(highlight);
      cancelAnimation(shine);
    };
  }, [playing, geometry, reduced, highlight, progress, shine]);

  const backgroundStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.get(),
  }));
  const liftedBackgroundStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
  }));
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : progress.get(),
  }));
  const artworkStyle = useAnimatedStyle(() => {
    if (!geometry) return { opacity: 0 };
    const corners = reduced ? geometry.to : interpolateCorners(geometry.from, geometry.to, progress.get());
    const matrix = perspectiveMatrix(geometry.width, geometry.height, corners);
    return {
      opacity: matrix ? (reduced ? progress.get() : 1) : 0,
      transform: matrix ? [{ matrix }] : [],
    };
  });
  const highlightStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : highlight.get() * (1 - shine.get() * 0.65),
  }));
  const shineStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: (geometry?.width ?? 0) * 0.46 * (-1.7 + shine.get() * 4.9),
      },
      { skewX: "-18deg" },
    ],
  }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, backgroundStyle]}>{background()}</Animated.View>
      {geometry && (
        <Animated.View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, liftedBackgroundStyle]}
        >
          {background(LIFTED_BLUR)}
          <View style={[StyleSheet.absoluteFill, styles.wash]} />
        </Animated.View>
      )}
      {geometry && crop && (
        <Animated.View style={[styles.artwork, { width: geometry.width, height: geometry.height }, artworkStyle]}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.shadow, shadowStyle]} />
          <View style={[StyleSheet.absoluteFill, styles.crop]}>
            <Image
              cachePolicy="memory"
              source={crop}
              contentFit="fill"
              onDisplay={onCropDisplay}
              onError={onError}
              accessibilityLabel="Isolated painting"
              style={{ position: "absolute", ...geometry.image }}
            />
            {!reduced && (
              <Animated.View
                style={[
                  styles.shine,
                  {
                    width: geometry.width * 0.46,
                    height: geometry.height * 1.5,
                    top: -geometry.height * 0.25,
                  },
                  shineStyle,
                ]}
              />
            )}
          </View>
          <Animated.View style={[styles.highlight, highlightStyle]} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  artwork: {
    position: "absolute",
    top: 0,
    left: 0,
    transformOrigin: [0, 0, 0],
  },
  crop: { overflow: "hidden" },
  wash: { backgroundColor: Colors.light.background, opacity: 0.65 },
  shadow: {
    backgroundColor: Colors.light.background,
    boxShadow: "0 20px 36px -10px rgba(17,17,17,0.35)",
  },
  highlight: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1.5,
    borderColor: Colors.light.overlayText,
  },
  shine: {
    position: "absolute",
    left: 0,
    experimental_backgroundImage:
      "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(240,244,255,0.2) 28%, rgba(255,255,255,0.62) 48%, rgba(255,255,255,0.75) 52%, rgba(255,249,232,0.33) 66%, rgba(255,255,255,0) 100%)",
  },
});
