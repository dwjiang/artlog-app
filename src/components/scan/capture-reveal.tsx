import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Colors } from '@/constants/theme';
import { interpolateCorners, perspectiveMatrix, revealGeometry } from '@/lib/capture/reveal-geometry';
import type { CapturePresentation } from '@/lib/capture/use-capture';

export const HIGHLIGHT_MS = 150;
export const STRAIGHTEN_MS = 300;
export const CROSSFADE_MS = 150;

export function CaptureReveal({ presentation, insets, onComplete }: {
  presentation: CapturePresentation;
  insets?: { top: number; bottom: number };
  onComplete: () => void;
}) {
  const { photo, photoUri, source, painting, crop } = presentation;
  const fit = source === 'camera' ? 'cover' : 'contain';
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [displayed, setDisplayed] = useState(false);
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const highlight = useSharedValue(0);
  const completed = useRef(false);
  const callback = useRef(onComplete);
  useEffect(() => { callback.current = onComplete; }, [onComplete]);
  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    callback.current();
  }, []);
  const geometry = useMemo(() => painting ? revealGeometry(painting, layout, fit, insets) : null, [painting, layout, fit, insets]);

  useEffect(() => {
    if (!painting) return;
    // A missing layout or native image event cannot strand a valid scan on this screen.
    const timer = setTimeout(finish, 2000);
    return () => clearTimeout(timer);
  }, [painting, finish]);

  useEffect(() => {
    if (!painting || !layout.width || !layout.height) return;
    if (!geometry) { finish(); return; }
    if (!displayed || completed.current) return;
    highlight.set(withTiming(1, { duration: reduced ? 0 : HIGHLIGHT_MS }));
    progress.set(withDelay(reduced ? 0 : HIGHLIGHT_MS, withTiming(1, {
      duration: reduced ? CROSSFADE_MS : STRAIGHTEN_MS,
      easing: Easing.bezier(0.77, 0, 0.175, 1), reduceMotion: ReduceMotion.Never,
    }, (finished) => { if (finished) scheduleOnRN(finish); })));
    return () => { cancelAnimation(progress); cancelAnimation(highlight); };
  }, [displayed, painting, layout.width, layout.height, geometry, reduced, finish, highlight, progress]);

  const backgroundStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));
  const artworkStyle = useAnimatedStyle(() => {
    if (!geometry) return { opacity: 0 };
    const corners = reduced ? geometry.to : interpolateCorners(geometry.from, geometry.to, progress.get());
    const matrix = perspectiveMatrix(geometry.width, geometry.height, corners);
    return { opacity: matrix ? (reduced ? progress.get() : 1) : 0, transform: matrix ? [{ matrix }] : [] };
  });
  const highlightStyle = useAnimatedStyle(() => ({ opacity: highlight.get() * (1 - progress.get()) }));

  return (
    <View pointerEvents="none" style={styles.container} onLayout={({ nativeEvent: { layout: next } }) => setLayout({ width: next.width, height: next.height })}>
      <Animated.View style={[StyleSheet.absoluteFill, backgroundStyle]}>
        <Image source={photo ?? photoUri} contentFit={fit} style={StyleSheet.absoluteFill} onError={finish} accessibilityLabel="Captured painting" />
      </Animated.View>
      {geometry && crop && <Animated.View style={[styles.artwork, { width: geometry.width, height: geometry.height }, artworkStyle]}>
        <Image source={crop} contentFit="fill" onDisplay={() => setDisplayed(true)} onError={finish}
          accessibilityLabel="Isolated painting" style={{ position: 'absolute', width: geometry.imageSize, height: geometry.imageSize, left: geometry.imageLeft, top: geometry.imageTop }} />
        <Animated.View style={[styles.highlight, highlightStyle]} />
      </Animated.View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFill, backgroundColor: Colors.light.background, overflow: 'hidden' },
  artwork: { position: 'absolute', top: 0, left: 0, overflow: 'hidden', transformOrigin: [0, 0, 0] },
  highlight: { ...StyleSheet.absoluteFill, borderWidth: 2, borderColor: Colors.light.accent },
});
