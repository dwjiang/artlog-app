import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Gallery } from '@/constants/theme';
import { fitPhoto, moveCropCorner } from '@/lib/capture/crop-geometry';
import type { Quad } from '@/lib/capture/stages';

const labels = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
export function CropCorners({ uri, size, corners, onChange }: {
  uri: string; size: { width: number; height: number }; corners: Quad; onChange: (corners: Quad) => void;
}) {
  const [frame, setFrame] = useState({ width: 1, height: 1 });
  const photo = fitPhoto(size, frame);
  return <View style={styles.canvas} onLayout={({ nativeEvent: { layout } }) => setFrame(layout)}>
    <Image source={uri} contentFit="contain" style={StyleSheet.absoluteFill} accessibilityLabel="Full photo for crop adjustment" />
    <View style={{ position: 'absolute', ...photo }}>
      {corners.map(([x, y], i) => {
        const next = corners[(i + 1) % 4], dx = (next[0] - x) * photo.width, dy = (next[1] - y) * photo.height;
        return <View key={`edge-${i}`} pointerEvents="none" style={{ position: 'absolute', left: x * photo.width, top: y * photo.height,
          height: 2, width: Math.hypot(dx, dy), backgroundColor: Gallery.accent, transformOrigin: 'left center', transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }} />;
      })}
      {corners.map((_, i) => <Corner key={i} index={i} corners={corners} width={photo.width} height={photo.height} onChange={onChange} />)}
    </View>
  </View>;
}

function Corner({ index, corners, width, height, onChange }: { index: number; corners: Quad; width: number; height: number; onChange: (quad: Quad) => void }) {
  const origin = useRef({ point: corners[index], pageX: 0, pageY: 0 });
  const [x, y] = corners[index];
  return <View onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderTerminationRequest={() => false}
    onResponderGrant={({ nativeEvent: { pageX, pageY } }) => { origin.current = { point: corners[index], pageX, pageY }; }}
    onResponderMove={({ nativeEvent: { pageX, pageY } }) => onChange(moveCropCorner(corners, index,
      origin.current.point[0] + (pageX - origin.current.pageX) / width,
      origin.current.point[1] + (pageY - origin.current.pageY) / height))}
    accessible accessibilityRole="adjustable" accessibilityLabel={`${labels[index]} corner`}
    accessibilityHint="Drag to the painting corner, or use actions to move it."
    accessibilityValue={{ text: `${Math.round(x * 100)} percent across, ${Math.round(y * 100)} percent down` }}
    accessibilityActions={[{ name: 'left', label: 'Move left' }, { name: 'right', label: 'Move right' }, { name: 'up', label: 'Move up' }, { name: 'down', label: 'Move down' }]}
    onAccessibilityAction={({ nativeEvent: { actionName } }) => onChange(moveCropCorner(corners, index,
      x + (actionName === 'left' ? -0.01 : actionName === 'right' ? 0.01 : 0), y + (actionName === 'up' ? -0.01 : actionName === 'down' ? 0.01 : 0)))}
    style={[styles.handle, { left: x * width - 24, top: y * height - 24 }]}>
    <View style={styles.dot} />
  </View>;
}
const styles = StyleSheet.create({
  canvas: { flex: 1, minHeight: 180, margin: 24, backgroundColor: Gallery.fill },
  handle: { position: 'absolute', width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: Gallery.surface, backgroundColor: Gallery.accent, boxShadow: '0 1px 5px #0006' },
});
