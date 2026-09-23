import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  interpolateCorners,
  perspectiveMatrix,
  revealGeometry,
} from "@/lib/capture/reveal-geometry";
import type { CapturePresentation } from "@/lib/capture/use-capture";

export const HIGHLIGHT_MS = 150;
export const STRAIGHTEN_MS = 650;
export const CROSSFADE_MS = 150;
export const SHINE_DELAY_MS = 350;
export const SHINE_MS = 950;
export const REVEAL_TIMEOUT_MS = HIGHLIGHT_MS + SHINE_DELAY_MS + SHINE_MS + 2000;

export function CaptureReveal({
  presentation,
  insets,
  onComplete,
}: {
  presentation: CapturePresentation;
  insets?: { top: number; bottom: number };
  onComplete: () => void;
}) {
  const { photo, photoUri, source, painting, crop } = presentation;
  const fit = source === "camera" ? "cover" : "contain";
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [displayed, setDisplayed] = useState(false);
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const highlight = useSharedValue(0);
  const shine = useSharedValue(0);
  const completed = useRef(false);
  const callback = useRef(onComplete);
  useEffect(() => {
    callback.current = onComplete;
  }, [onComplete]);
  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    callback.current();
  }, []);
  const geometry = useMemo(
    () => (painting ? revealGeometry(painting, layout, fit, insets) : null),
    [painting, layout, fit, insets],
  );

  useEffect(() => {
    if (!painting) return;
    // A missing layout or native image event cannot strand a valid scan on this screen.
    const timer = setTimeout(finish, REVEAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [painting, finish]);

  useEffect(() => {
    if (!painting || !layout.width || !layout.height) return;
    if (!geometry) {
      finish();
      return;
    }
    if (!displayed || completed.current) return;
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
          (finished) => {
            if (finished && reduced) scheduleOnRN(finish);
          },
        ),
      ),
    );
    if (!reduced)
      shine.set(
        withDelay(
          HIGHLIGHT_MS + SHINE_DELAY_MS,
          withTiming(
            1,
            {
              duration: SHINE_MS,
              easing: Easing.bezier(0.2, 0, 0.45, 1),
            },
            (finished) => {
              if (finished) scheduleOnRN(finish);
            },
          ),
        ),
      );
    return () => {
      cancelAnimation(progress);
      cancelAnimation(highlight);
      cancelAnimation(shine);
    };
  }, [
    displayed,
    painting,
    layout.width,
    layout.height,
    geometry,
    reduced,
    finish,
    highlight,
    progress,
    shine,
  ]);

  const backgroundStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));
  const liftedBackgroundStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const shadowStyle = useAnimatedStyle(() => ({ opacity: reduced ? 0 : progress.get() }));
  const artworkStyle = useAnimatedStyle(() => {
    if (!geometry) return { opacity: 0 };
    const corners = reduced
      ? geometry.to
      : interpolateCorners(geometry.from, geometry.to, progress.get());
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
      { translateX: (geometry?.width ?? 0) * 0.46 * (-1.7 + shine.get() * 4.9) },
      { skewX: "-18deg" },
    ],
  }));

  return (
    <View
      pointerEvents="none"
      style={styles.container}
      onLayout={({ nativeEvent: { layout: next } }) =>
        setLayout({ width: next.width, height: next.height })
      }
    >
      <Animated.View style={[StyleSheet.absoluteFill, backgroundStyle]}>
        <Image
          source={photo ?? photoUri}
          contentFit={fit}
          style={StyleSheet.absoluteFill}
          onError={finish}
          accessibilityLabel="Captured painting"
        />
      </Animated.View>
      {painting && (
        <Animated.View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, liftedBackgroundStyle]}
        >
          <Image
            source={photo ?? photoUri}
            contentFit={fit}
            blurRadius={12}
            style={StyleSheet.absoluteFill}
            accessible={false}
          />
          <View style={[StyleSheet.absoluteFill, styles.wash]} />
        </Animated.View>
      )}
      {geometry && crop && (
        <Animated.View
          style={[styles.artwork, { width: geometry.width, height: geometry.height }, artworkStyle]}
        >
          <Animated.View style={[StyleSheet.absoluteFill, styles.shadow, shadowStyle]} />
          <View style={[StyleSheet.absoluteFill, styles.crop]}>
            <Image
              source={crop}
              contentFit="fill"
              onDisplay={() => setDisplayed(true)}
              onError={finish}
              accessibilityLabel="Isolated painting"
              style={{
                position: "absolute",
                width: geometry.imageSize,
                height: geometry.imageSize,
                left: geometry.imageLeft,
                top: geometry.imageTop,
              }}
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
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.light.background,
    overflow: "hidden",
  },
  artwork: { position: "absolute", top: 0, left: 0, transformOrigin: [0, 0, 0] },
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
