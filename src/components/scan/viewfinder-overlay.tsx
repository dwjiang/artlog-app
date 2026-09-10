import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { Guidance } from '@/lib/capture/rectangle';
import type { LiveQuad } from '@/lib/capture/use-rect-detector';

export const guidanceMessages: Record<Guidance, string | null> = {
  searching: 'Point at a painting',
  'move-closer': 'Move closer',
  'fit-whole-painting': 'Get the whole painting in frame',
  straighten: 'Straighten up',
  'hold-still': 'Hold still',
  ready: null,
};

const CORNER_SIZE = 10;
const EDGE_WIDTH = 2;
const FOLLOW_MS = 90;
// Edge directions keep every angle near 0 or π/2 so the rotation never wraps while animating.
const EDGES: [number, number][] = [[0, 1], [3, 2], [0, 3], [1, 2]];

type ViewPoint = [number, number];

export function GuidanceLabel({ guidance }: { guidance: Guidance }) {
  const message = guidanceMessages[guidance];
  if (!message) return null;
  return (
    <View style={styles.label}>
      <ThemedText>{message}</ThemedText>
    </View>
  );
}

export function ViewfinderOverlay({ liveQuad, guidance }: { liveQuad: SharedValue<LiveQuad>; guidance: Guidance }) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const points = useDerivedValue<ViewPoint[] | null>(() => {
    const live = liveQuad.get();
    if (!live || layout.width === 0 || layout.height === 0) return null;
    // The preview fills the view (VisionCamera `resizeMode: 'cover'`), so scale the upright frame to cover it.
    const scale = Math.max(layout.width / live.frameWidth, layout.height / live.frameHeight);
    const offsetX = (layout.width - live.frameWidth * scale) / 2;
    const offsetY = (layout.height - live.frameHeight * scale) / 2;
    return live.quad.map(([x, y]) => [x * live.frameWidth * scale + offsetX, y * live.frameHeight * scale + offsetY]);
  }, [layout]);
  const color = guidance === 'ready' ? Colors.light.accent : Colors.light.background;

  function onLayout({ nativeEvent }: LayoutChangeEvent) {
    setLayout({ width: nativeEvent.layout.width, height: nativeEvent.layout.height });
  }

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout} accessibilityLabel="Painting outline">
      {EDGES.map(([from, to]) => <Edge key={`${from}-${to}`} points={points} from={from} to={to} color={color} />)}
      {[0, 1, 2, 3].map((index) => <Corner key={index} points={points} index={index} color={color} />)}
    </View>
  );
}

type Shared = { points: SharedValue<ViewPoint[] | null>; color: string };

function Corner({ points, index, color }: Shared & { index: number }) {
  const style = useAnimatedStyle(() => {
    const point = points.get()?.[index];
    if (!point) return { opacity: 0 };
    return {
      opacity: withTiming(1, { duration: FOLLOW_MS }),
      transform: [
        { translateX: withTiming(point[0] - CORNER_SIZE / 2, { duration: FOLLOW_MS }) },
        { translateY: withTiming(point[1] - CORNER_SIZE / 2, { duration: FOLLOW_MS }) },
      ],
    };
  });
  return <Animated.View style={[styles.corner, { backgroundColor: color }, style]} />;
}

function Edge({ points, from, to, color }: Shared & { from: number; to: number }) {
  const style = useAnimatedStyle(() => {
    const a = points.get()?.[from];
    const b = points.get()?.[to];
    if (!a || !b) return { opacity: 0 };
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return {
      opacity: withTiming(1, { duration: FOLLOW_MS }),
      width: withTiming(length, { duration: FOLLOW_MS }),
      transform: [
        { translateX: withTiming((a[0] + b[0]) / 2 - length / 2, { duration: FOLLOW_MS }) },
        { translateY: withTiming((a[1] + b[1]) / 2 - EDGE_WIDTH / 2, { duration: FOLLOW_MS }) },
        { rotate: `${angle}rad` },
      ],
    };
  });
  return <Animated.View style={[styles.edge, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  label: { alignSelf: 'center', backgroundColor: Colors.light.background, borderRadius: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  corner: { position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE, borderRadius: CORNER_SIZE / 2 },
  edge: { position: 'absolute', height: EDGE_WIDTH, opacity: 0 },
});
