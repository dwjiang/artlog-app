import { StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';

export type Segment = { cx: number; cy: number; length: number; angle: number };

/** The four edges of the matched quadrilateral, centred so a rotated view draws each one. */
export function edgeSegments(corners: number[][] | undefined, scale: number): Segment[] {
  if (!corners || corners.length !== 4 || !corners.every((point) => point.length >= 2 && point.slice(0, 2).every(Number.isFinite))) {
    return [];
  }
  return corners.map((a, index) => {
    const b = corners[(index + 1) % 4];
    const dx = (b[0] - a[0]) * scale;
    const dy = (b[1] - a[1]) * scale;
    return { cx: ((a[0] + b[0]) / 2) * scale, cy: ((a[1] + b[1]) / 2) * scale, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
  });
}

export type CornersOverlayProps = {
  /** Corners in crop pixels (`inputSize` square), as the verifier projected them. */
  corners?: number[][];
  inputSize: number;
  /** The rendered width of the square crop. */
  size: number;
};

export function CornersOverlay({ corners, inputSize, size }: CornersOverlayProps) {
  const segments = edgeSegments(corners, size / inputSize);
  if (segments.length === 0) return null;
  return (
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      {segments.map((segment, index) => (
        <View
          key={index}
          style={[styles.edge, {
            left: segment.cx - segment.length / 2, top: segment.cy - styles.edge.height / 2, width: segment.length,
            transform: [{ rotate: `${segment.angle}rad` }],
          }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', height: 3, borderRadius: 1.5, backgroundColor: Colors.light.accent },
});
