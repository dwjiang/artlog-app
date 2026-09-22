import { Canvas, Path } from '@shopify/react-native-skia';
import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { cancelAnimation, Easing, useSharedValue, withTiming } from 'react-native-reanimated';

import { Colors, Gallery } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import type { CaptureController } from '@/lib/capture/capture-controller';
import type { FrameSize } from '@/lib/capture/rectangle';
import { OverlayCaption } from './overlay-caption';

const SHUTTER_SIZE = 72;
const RING_SIZE = SHUTTER_SIZE + 14;
const RING_RADIUS = RING_SIZE / 2 - 2;
const ring = `M ${RING_SIZE / 2} 2 a ${RING_RADIUS} ${RING_RADIUS} 0 1 1 0 ${RING_RADIUS * 2} a ${RING_RADIUS} ${RING_RADIUS} 0 1 1 0 ${-RING_RADIUS * 2}`;

export function CaptureFeedback({ controller, detecting, busy }: { controller: CaptureController; detecting: boolean; busy: boolean }) {
  const holding = useSyncExternalStore(controller.subscribeFeedback, () => detecting && (controller.getFeedback()?.progress ?? 0) > 0);
  const label = busy ? 'Identifying artwork' : holding ? 'Hold steady' : undefined;
  return <View style={styles.feedback} accessibilityLiveRegion="polite">
    {label && <OverlayCaption>{label}</OverlayCaption>}
  </View>;
}

export function CaptureOutline({ controller, preview }: { controller: CaptureController; preview: FrameSize }) {
  const feedback = useSyncExternalStore(controller.subscribeFeedback, controller.getFeedback);
  if (!feedback || !preview.width || !preview.height) return null;
  const corners = feedback.quad.map(([x, y]) => [x * preview.width, y * preview.height]);
  const holding = feedback.progress > 0;
  const outline = corners.map(([x, y], index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ') + ' Z';
  const brackets = corners.map(([x, y], index) => {
    const tip = (neighbor: number[]) => {
      const dx = neighbor[0] - x, dy = neighbor[1] - y;
      const fraction = Math.min(24 / Math.hypot(dx, dy), 0.25);
      return `${x + dx * fraction} ${y + dy * fraction}`;
    };
    return `M ${tip(corners[(index + 3) % 4])} L ${x} ${y} L ${tip(corners[(index + 1) % 4])}`;
  }).join(' ');
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    <Canvas style={StyleSheet.absoluteFill}>
      {holding && <Path path={outline} color={Gallery.highlight} style="stroke" strokeWidth={1} opacity={0.45} />}
      <Path path={brackets} color={holding ? Gallery.highlight : Colors.light.overlayText} style="stroke" strokeWidth={holding ? 3 : 2} strokeCap="round" strokeJoin="round" />
    </Canvas>
  </View>;
}

/** `captured` keeps the ring closed for a camera capture: detection stops and clears its feedback the instant the shutter fires. */
export function CaptureShutter({ controller, disabled, busy, captured, detecting, onPress }: {
  controller: CaptureController; disabled: boolean; busy: boolean; captured: boolean; detecting: boolean; onPress: () => void;
}) {
  const progressed = useSyncExternalStore(controller.subscribeFeedback, () => controller.getFeedback()?.progress ?? 0);
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const value = captured ? 1 : detecting ? progressed : 0;
  useEffect(() => {
    progress.set(withTiming(value, { duration: reduced || value === 0 ? 0 : 80, easing: Easing.linear }));
    return () => cancelAnimation(progress);
  }, [value, progress, reduced]);
  return <View style={styles.shutterContainer}>
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.ring}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Path path={ring} color={Gallery.highlight} style="stroke" strokeWidth={3} strokeCap="round" end={progress} />
      </Canvas>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Scan artwork" accessibilityHint="Scans now instead of waiting for automatic detection"
      disabled={disabled} accessibilityState={{ disabled, busy }} onPress={onPress}
      style={({ pressed }) => [styles.shutter, (pressed || disabled) && styles.dimmed]}>
      <View style={styles.shutterInner} />
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  feedback: { minHeight: 44, justifyContent: 'center' },
  shutterContainer: { width: SHUTTER_SIZE, height: SHUTTER_SIZE },
  ring: { position: 'absolute', width: RING_SIZE, height: RING_SIZE, left: -7, top: -7 },
  shutter: { width: SHUTTER_SIZE, height: SHUTTER_SIZE, borderRadius: SHUTTER_SIZE / 2, borderWidth: 3, borderColor: Colors.light.overlayText, padding: 4 },
  shutterInner: { flex: 1, borderRadius: SHUTTER_SIZE / 2, backgroundColor: Colors.light.overlayText },
  dimmed: { opacity: 0.7 },
});
