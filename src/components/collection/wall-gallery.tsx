import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { DisplayMedia } from '@/components/artwork/display-media';
import { Gallery } from '@/constants/theme';
import { constrainLayout, isLightWall, wallAspect, wallBottom, type WallLayout, type WallPiece } from '@/lib/wall/wall-layout';
import { SavedWorkImage } from './saved-work-image';
import { WallFrame, wallFrameInset } from './wall-frame';

export function WallArtwork({ piece, width }: { piece: WallPiece; width: number }) {
  const innerWidth = Math.max(1, width - wallFrameInset(piece.layout.frame, width) * 2);
  return <WallFrame frame={piece.layout.frame} width={width}>
    {piece.cropPath ? <SavedWorkImage path={piece.cropPath} title={piece.artwork.title} contain
      style={{ width: innerWidth, aspectRatio: wallAspect(piece) }} />
      : <DisplayMedia media={piece.artwork.media} label={piece.artwork.title} width={innerWidth} />}
  </WallFrame>;
}

export function WallGallery({ pieces, color, width, editing = false, onSelect, onMove, children }: {
  pieces: WallPiece[]; color: string; width: number; editing?: boolean;
  onSelect: (piece: WallPiece) => void; onMove?: (id: string, layout: WallLayout) => void; children?: React.ReactNode;
}) {
  const light = isLightWall(color);
  return <View style={{ width, minHeight: pieces.length ? 580 : 440, height: Math.max(440, wallBottom(pieces) * width + 85),
    backgroundColor: color, experimental_backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.10) 0%, transparent 24%, rgba(0,0,0,0.09) 100%)' }}>
    {pieces.map((piece) => <Hanging key={piece.localId} piece={piece} width={width} editing={editing}
      labelColor={light ? Gallery.ink : Gallery.paper} onSelect={onSelect} onMove={onMove} />)}
    {children}
  </View>;
}

function Hanging({ piece, width, editing, labelColor, onSelect, onMove }: {
  piece: WallPiece; width: number; editing: boolean; labelColor: string;
  onSelect: (piece: WallPiece) => void; onMove?: (id: string, layout: WallLayout) => void;
}) {
  const offsetX = useSharedValue(0), offsetY = useSharedValue(0), dragging = useSharedValue(false);
  const layout = piece.layout;
  useEffect(() => { offsetX.set(0); offsetY.set(0); }, [layout.x, layout.y, offsetX, offsetY]);
  const pan = Gesture.Pan().enabled(editing).activateAfterLongPress(220)
    .onStart(() => { dragging.set(true); })
    .onUpdate((event) => {
      const next = constrainLayout(layout, { x: layout.x + event.translationX / width, y: layout.y + event.translationY / width });
      offsetX.set((next.x - layout.x) * width); offsetY.set((next.y - layout.y) * width);
    })
    .onEnd(() => {
      if (onMove) scheduleOnRN(onMove, piece.localId, constrainLayout(layout, {
        x: layout.x + offsetX.get() / width, y: layout.y + offsetY.get() / width,
      }));
    })
    .onFinalize((_event, success) => {
      dragging.set(false);
      if (!success) { offsetX.set(0); offsetY.set(0); }
    });
  const motion = useAnimatedStyle(() => ({ transform: [{ translateX: offsetX.get() }, { translateY: offsetY.get() }],
    zIndex: dragging.get() ? 101 : layout.layer, opacity: dragging.get() ? 0.92 : 1 }));
  const hanging = <Animated.View style={[{ position: 'absolute', left: layout.x * width, top: layout.y * width, width: layout.width * width }, motion]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${piece.artwork.title}, ${piece.artwork.artist}`}
        accessibilityHint={editing ? 'Opens frame, size, and position controls. Hold and drag to move.' : 'Opens artwork details.'}
        onPress={() => onSelect(piece)}>
        <WallArtwork piece={piece} width={layout.width * width} />
        {editing && <View style={styles.editBadge}><Image source="sf:arrow.up.and.down.and.arrow.left.and.right"
          style={{ width: 12, height: 12 }} tintColor={Gallery.ink} /></View>}
        {layout.width * width >= 78 && <View style={styles.label}>
          <Text numberOfLines={1} style={[styles.artist, { color: labelColor }]}>{piece.artwork.artist}</Text>
          <Text numberOfLines={1} style={[styles.title, { color: labelColor }]}>{piece.artwork.title}</Text>
        </View>}
      </Pressable>
    </Animated.View>;
  return editing ? <GestureDetector gesture={pan}>{hanging}</GestureDetector> : hanging;
}

const styles = StyleSheet.create({
  label: { paddingTop: 6 },
  artist: { fontSize: 10, lineHeight: 13, fontWeight: '600' },
  title: { fontSize: 10, lineHeight: 13, fontStyle: 'italic', opacity: 0.8 },
  editBadge: { position: 'absolute', top: -10, right: -10, width: 26, height: 26,
    backgroundColor: Gallery.paper, borderRadius: 13, justifyContent: 'center', alignItems: 'center', boxShadow: '0 1px 4px #0003' },
});
