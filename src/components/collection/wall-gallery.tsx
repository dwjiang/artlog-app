import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, type NativeGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import {
  constrainWallPiece,
  isLightWall,
  resizeWallLayout,
  wallPieceBounds,
  wallBottom,
  type WallCorner,
  type WallLayout,
  type WallPiece,
  type Wallpaper,
} from "@/lib/wall/wall-layout";

import { WallArtwork } from "./wall-artwork";
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
  scrollGesture,
  onDeselect,
  children,
}: {
  pieces: WallPiece[];
  wallpaper: Wallpaper;
  width: number;
  editing?: boolean;
  selectedId?: string;
  scrollGesture?: NativeGesture;
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
    <View
      style={{ width, minHeight, height: Math.max(minHeight, wallBottom(pieces, width) * width + 85) + bottomInset }}
    >
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
          pieces={pieces}
          scrollGesture={scrollGesture}
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
  pieces,
  scrollGesture,
  width,
  editing,
  labelColor,
  onSelect,
  onMove,
  selected,
}: {
  piece: WallPiece;
  pieces: WallPiece[];
  scrollGesture?: NativeGesture;
  width: number;
  editing: boolean;
  labelColor: string;
  selected: boolean;
  onSelect: (piece: WallPiece) => void;
  onMove?: (id: string, layout: WallLayout) => void;
}) {
  const { layout } = piece;
  const preview = useSharedValue(layout);
  const dragging = useSharedValue(false);
  const artworkWidth = layout.width * width;
  const artworkHeight = wallPieceBounds(piece, width).height * width;
  useEffect(() => {
    preview.set(layout);
  }, [layout, editing, preview]);
  const pan = Gesture.Pan()
    .withTestId(`move-${piece.localId}`)
    .enabled(editing)
    .minDistance(3)
    // The outer padding belongs to the resize handles; blank wall remains available for scrolling.
    .hitSlop(-22)
    .blocksExternalGesture(...(scrollGesture ? [scrollGesture] : []))
    .onStart(() => {
      dragging.set(true);
      scheduleOnRN(onSelect, piece);
    })
    .onUpdate((event) => {
      preview.set(
        constrainWallPiece(
          { ...piece, layout: preview.get() },
          {
            x: layout.x + event.translationX / width,
            y: layout.y + event.translationY / width,
          },
          pieces,
          width,
        ),
      );
    })
    .onEnd((event, success) => {
      if (success && onMove) {
        const next = constrainWallPiece(
          { ...piece, layout: preview.get() },
          {
            x: layout.x + event.translationX / width,
            y: layout.y + event.translationY / width,
          },
          pieces,
          width,
        );
        preview.set(next);
        scheduleOnRN(onMove, piece.localId, next);
      }
    })
    .onFinalize((_event, success) => {
      dragging.set(false);
      if (!success) preview.set(layout);
    });
  const size = useAnimatedStyle(() => ({
    transform: [{ scale: preview.get().width / layout.width }],
    transformOrigin: "top left",
  }));
  const motion = useAnimatedStyle(() => ({
    transform: [
      { translateX: (preview.get().x - layout.x) * width },
      { translateY: (preview.get().y - layout.y) * width },
    ],
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
              ? "Drag to move. Swipe empty wall space to scroll. Drag any corner to resize. Tap empty wall space to deselect."
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
            if (patches[actionName]) {
              onMove(piece.localId, constrainWallPiece(piece, patches[actionName], pieces, width));
            }
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
            pieces={pieces}
            scrollGesture={scrollGesture}
            preview={preview}
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
  pieces,
  scrollGesture,
  preview,
  onMove,
}: {
  corner: WallCorner;
  piece: WallPiece;
  wallWidth: number;
  artworkWidth: number;
  artworkHeight: number;
  pan: ReturnType<typeof Gesture.Pan>;
  pieces: WallPiece[];
  scrollGesture?: NativeGesture;
  preview: SharedValue<WallLayout>;
  onMove?: (id: string, layout: WallLayout) => void;
}) {
  const { layout } = piece;
  const left = corner.endsWith("left");
  const top = corner.startsWith("top");
  const resize = Gesture.Pan()
    .withTestId(`resize-${piece.localId}-${corner}`)
    .minDistance(0)
    .blocksExternalGesture(pan, ...(scrollGesture ? [scrollGesture] : []))
    .onUpdate((event) => {
      const next = resizeWallLayout(
        layout,
        corner,
        { x: event.translationX / wallWidth, y: event.translationY / wallWidth },
        artworkWidth / artworkHeight,
      );
      preview.set(constrainWallPiece({ ...piece, layout: preview.get() }, next, pieces, wallWidth));
    })
    .onEnd((event, success) => {
      if (success && onMove) {
        const next = constrainWallPiece(
          { ...piece, layout: preview.get() },
          resizeWallLayout(
            layout,
            corner,
            { x: event.translationX / wallWidth, y: event.translationY / wallWidth },
            artworkWidth / artworkHeight,
          ),
          pieces,
          wallWidth,
        );
        preview.set(next);
        scheduleOnRN(onMove, piece.localId, next);
      }
    })
    .onFinalize((_event, success) => {
      if (!success) preview.set(layout);
    });
  const position = useAnimatedStyle(() => ({
    transform: [
      { translateX: left ? 0 : artworkWidth * (preview.get().width / layout.width - 1) },
      { translateY: top ? 0 : artworkHeight * (preview.get().width / layout.width - 1) },
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
