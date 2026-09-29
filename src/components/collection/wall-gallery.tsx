import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import {
  constrainLayout,
  isLightWall,
  resizeWallLayout,
  wallAspect,
  wallBottom,
  type WallCorner,
  type WallLayout,
  type WallPiece,
  type Wallpaper,
} from "@/lib/wall/wall-layout";

import { WallArtwork } from "./wall-artwork";
import { wallFrameInset } from "./wall-frame";
import { wallpaperStyle } from "./wallpaper";

const corners: WallCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

export function WallGallery({
  pieces,
  wallpaper,
  width,
  minHeight = pieces.length > 0 ? 580 : 440,
  editing = false,
  bottomInset = 0,
  backgroundBottomInset = 0,
  onSelect,
  onMove,
  selectedId,
  onDeselect,
  children,
}: {
  pieces: WallPiece[];
  wallpaper: Wallpaper;
  width: number;
  editing?: boolean;
  selectedId?: string;
  onDeselect?: () => void;
  minHeight?: number;
  bottomInset?: number;
  backgroundBottomInset?: number;
  onSelect: (piece: WallPiece) => void;
  onMove?: (id: string, layout: WallLayout) => void;
  children?: React.ReactNode;
}) {
  const light = isLightWall(wallpaper.color);
  return (
    <View style={{ width, minHeight, height: Math.max(minHeight, wallBottom(pieces) * width + 85) + bottomInset }}>
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, wallpaperStyle(wallpaper), { bottom: -backgroundBottomInset }]}
      />
      {editing && selectedId && onDeselect && (
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Deselect artwork"
          onPress={onDeselect}
        />
      )}
      {pieces.map((piece) => (
        <Hanging
          key={piece.localId}
          piece={piece}
          width={width}
          editing={editing}
          selected={selectedId === piece.localId}
          labelColor={light ? Gallery.ink : Gallery.paper}
          onSelect={onSelect}
          onMove={onMove}
        />
      ))}
      {children}
    </View>
  );
}

function Hanging({
  piece,
  width,
  editing,
  labelColor,
  onSelect,
  onMove,
  selected,
}: {
  piece: WallPiece;
  width: number;
  editing: boolean;
  labelColor: string;
  selected: boolean;
  onSelect: (piece: WallPiece) => void;
  onMove?: (id: string, layout: WallLayout) => void;
}) {
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const scale = useSharedValue(1);
  const { layout } = piece;
  const artworkWidth = layout.width * width;
  const inset = wallFrameInset(layout.frame, artworkWidth);
  const artworkHeight = (artworkWidth - inset * 2) / wallAspect(piece) + inset * 2;
  useEffect(() => {
    scale.set(1);
    offsetX.set(0);
    offsetY.set(0);
  }, [layout.width, layout.x, layout.y, offsetX, offsetY, scale]);
  const pan = Gesture.Pan()
    .enabled(editing)
    .activateAfterLongPress(220)
    .onStart(() => {
      dragging.set(true);
      scheduleOnRN(onSelect, piece);
    })
    .onUpdate((event) => {
      const next = constrainLayout(layout, {
        x: layout.x + event.translationX / width,
        y: layout.y + event.translationY / width,
      });
      offsetX.set((next.x - layout.x) * width);
      offsetY.set((next.y - layout.y) * width);
    })
    .onEnd((event, success) => {
      if (success && onMove) {
        scheduleOnRN(
          onMove,
          piece.localId,
          constrainLayout(layout, {
            x: layout.x + event.translationX / width,
            y: layout.y + event.translationY / width,
          }),
        );
      }
    })
    .onFinalize((_event, success) => {
      dragging.set(false);
      if (!success) {
        offsetX.set(0);
        offsetY.set(0);
      }
    });
  const size = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
    transformOrigin: "top left",
  }));
  const motion = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.get() }, { translateY: offsetY.get() }],
    zIndex: dragging.get() ? 101 : editing && selected ? 100 : layout.layer,
    opacity: dragging.get() ? 0.92 : 1,
  }));
  const hanging = (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: layout.x * width - 22,
          top: layout.y * width - 22,
          width: artworkWidth + 44,
          padding: 22,
        },
        motion,
      ]}
    >
      <Animated.View style={size}>
        <Pressable
          accessibilityRole={editing && selected ? "adjustable" : "button"}
          accessibilityLabel={`${piece.artwork.title}, ${piece.artwork.artist}`}
          accessibilityState={{ selected: editing && selected }}
          accessibilityHint={
            editing
              ? "Hold and drag to move. Drag any corner to resize. Tap empty wall space to deselect."
              : "Opens artwork details."
          }
          accessibilityValue={
            editing && selected
              ? {
                  min: 16,
                  max: 90,
                  now: Math.round(layout.width * 100),
                  text: `${Math.round(layout.width * 100)} percent wall width`,
                }
              : undefined
          }
          accessibilityActions={
            editing && selected
              ? [
                  { name: "increment", label: "Increase artwork size" },
                  { name: "decrement", label: "Decrease artwork size" },
                  { name: "moveLeft", label: "Move left" },
                  { name: "moveRight", label: "Move right" },
                  { name: "moveUp", label: "Move up" },
                  { name: "moveDown", label: "Move down" },
                ]
              : undefined
          }
          onAccessibilityAction={({ nativeEvent: { actionName } }) => {
            if (!editing || !selected || !onMove) return;
            const patches: Record<string, Partial<WallLayout>> = {
              increment: { width: layout.width + 0.04 },
              decrement: { width: layout.width - 0.04 },
              moveLeft: { x: layout.x - 0.025 },
              moveRight: { x: layout.x + 0.025 },
              moveUp: { y: layout.y - 0.025 },
              moveDown: { y: layout.y + 0.025 },
            };
            if (patches[actionName]) onMove(piece.localId, constrainLayout(layout, patches[actionName]));
          }}
          onPress={() => onSelect(piece)}
        >
          <View style={{ outlineColor: Gallery.accent, outlineWidth: editing && selected ? 1.5 : 0 }}>
            <WallArtwork piece={piece} width={artworkWidth} />
          </View>
          <View style={styles.label}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.artist, { color: labelColor }]}>
              {piece.artwork.artist}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={[styles.title, { color: labelColor }]}>
              {piece.artwork.title}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
      {editing
        && selected
        && corners.map((corner) => (
          <ResizeCorner
            key={corner}
            corner={corner}
            piece={piece}
            wallWidth={width}
            artworkWidth={artworkWidth}
            artworkHeight={artworkHeight}
            pan={pan}
            scale={scale}
            offsetX={offsetX}
            offsetY={offsetY}
            onMove={onMove}
          />
        ))}
    </Animated.View>
  );
  return editing ? <GestureDetector gesture={pan}>{hanging}</GestureDetector> : hanging;
}

function ResizeCorner({
  corner,
  piece,
  wallWidth,
  artworkWidth,
  artworkHeight,
  pan,
  scale,
  offsetX,
  offsetY,
  onMove,
}: {
  corner: WallCorner;
  piece: WallPiece;
  wallWidth: number;
  artworkWidth: number;
  artworkHeight: number;
  pan: ReturnType<typeof Gesture.Pan>;
  scale: SharedValue<number>;
  offsetX: SharedValue<number>;
  offsetY: SharedValue<number>;
  onMove?: (id: string, layout: WallLayout) => void;
}) {
  const { layout } = piece;
  const left = corner.endsWith("left");
  const top = corner.startsWith("top");
  const resize = Gesture.Pan()
    .withTestId(`resize-${piece.localId}-${corner}`)
    .minDistance(0)
    .blocksExternalGesture(pan)
    .onUpdate((event) => {
      const next = resizeWallLayout(
        layout,
        corner,
        { x: event.translationX / wallWidth, y: event.translationY / wallWidth },
        artworkWidth / artworkHeight,
      );
      scale.set(next.width / layout.width);
      offsetX.set((next.x - layout.x) * wallWidth);
      offsetY.set((next.y - layout.y) * wallWidth);
    })
    .onEnd((event, success) => {
      if (success && onMove) {
        scheduleOnRN(
          onMove,
          piece.localId,
          resizeWallLayout(
            layout,
            corner,
            { x: event.translationX / wallWidth, y: event.translationY / wallWidth },
            artworkWidth / artworkHeight,
          ),
        );
      }
    })
    .onFinalize((_event, success) => {
      if (!success) {
        scale.set(1);
        offsetX.set(0);
        offsetY.set(0);
      }
    });
  const position = useAnimatedStyle(() => ({
    transform: [
      { translateX: left ? 0 : artworkWidth * (scale.get() - 1) },
      { translateY: top ? 0 : artworkHeight * (scale.get() - 1) },
    ],
  }));
  return (
    <GestureDetector gesture={resize}>
      <Animated.View
        accessible={false}
        testID={`resize-${corner}`}
        style={[styles.cornerTarget, { left: left ? 0 : artworkWidth, top: top ? 0 : artworkHeight }, position]}
      >
        <View style={styles.cornerDot} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 14, gap: 2 },
  artist: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  title: { fontSize: 12, lineHeight: 16 },
  cornerTarget: { position: "absolute", width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  cornerDot: {
    width: 9,
    height: 9,
    backgroundColor: Gallery.paper,
    borderWidth: 1.5,
    borderColor: Gallery.accent,
    borderRadius: 2,
  },
});
