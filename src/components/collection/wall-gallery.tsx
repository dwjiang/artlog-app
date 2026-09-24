import { Image } from "expo-image";
import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import { constrainLayout, isLightWall, wallBottom, type WallLayout, type WallPiece } from "@/lib/wall/wall-layout";

import { WallArtwork } from "./wall-artwork";

export function WallGallery({
  pieces,
  color,
  width,
  minHeight = pieces.length > 0 ? 580 : 440,
  editing = false,
  onSelect,
  onMove,
  selectedId,
  onRemove,
  children,
}: {
  pieces: WallPiece[];
  color: string;
  width: number;
  editing?: boolean;
  selectedId?: string;
  onRemove?: (id: string) => void;
  minHeight?: number;
  onSelect: (piece: WallPiece) => void;
  onMove?: (id: string, layout: WallLayout) => void;
  children?: React.ReactNode;
}) {
  const light = isLightWall(color);
  return (
    <View
      style={{
        width,
        minHeight,
        height: Math.max(minHeight, wallBottom(pieces) * width + 85),
        backgroundColor: color,
      }}
    >
      {pieces.map((piece) => (
        <Hanging
          key={piece.localId}
          piece={piece}
          width={width}
          editing={editing}
          selected={selectedId === piece.localId}
          onRemove={onRemove}
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
  onRemove,
}: {
  piece: WallPiece;
  width: number;
  editing: boolean;
  labelColor: string;
  selected: boolean;
  onRemove?: (id: string) => void;
  onSelect: (piece: WallPiece) => void;
  onMove?: (id: string, layout: WallLayout) => void;
}) {
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const { layout } = piece;
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.set(1);
  }, [layout.width, scale]);
  useEffect(() => {
    offsetX.set(0);
    offsetY.set(0);
  }, [layout.x, layout.y, offsetX, offsetY]);
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
    .onEnd(() => {
      if (onMove) {
        scheduleOnRN(
          onMove,
          piece.localId,
          constrainLayout(layout, {
            x: layout.x + offsetX.get() / width,
            y: layout.y + offsetY.get() / width,
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
  const resize = Gesture.Pan()
    .enabled(editing && selected)
    .blocksExternalGesture(pan)
    .onUpdate((event) => {
      const next = constrainLayout(layout, {
        width: layout.width + event.translationX / width,
      });
      scale.set(next.width / layout.width);
    })
    .onEnd(() => {
      if (onMove) {
        scheduleOnRN(onMove, piece.localId, constrainLayout(layout, { width: layout.width * scale.get() }));
      }
    })
    .onFinalize((_event, success) => {
      if (!success) scale.set(1);
    });
  const size = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
    transformOrigin: "top left",
  }));
  const motion = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.get() }, { translateY: offsetY.get() }],
    zIndex: dragging.get() ? 101 : layout.layer,
    opacity: dragging.get() ? 0.92 : 1,
  }));
  const hanging = (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: layout.x * width,
          top: layout.y * width,
          width: layout.width * width,
        },
        motion,
      ]}
    >
      <Animated.View style={size}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${piece.artwork.title}, ${piece.artwork.artist}`}
          accessibilityHint={
            editing
              ? "Select to change the frame or photo. Hold and drag to move; drag the corner handle to resize."
              : "Opens artwork details."
          }
          onPress={() => onSelect(piece)}
        >
          <View
            style={{
              outlineColor: Gallery.accent,
              outlineWidth: editing && selected ? 2 : 0,
              outlineOffset: 5,
            }}
          >
            <WallArtwork piece={piece} width={layout.width * width} />
          </View>
          <View style={styles.label}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text maxFontSizeMultiplier={1.3} style={[styles.artist, { color: labelColor }]}>
                {piece.artwork.artist}
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={[styles.title, { color: labelColor }]}>
                {piece.artwork.title}
              </Text>
            </View>
          </View>
        </Pressable>
        {editing && selected && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${piece.artwork.title} from wall`}
              onPress={() => onRemove?.(piece.localId)}
              style={[
                styles.editBadge,
                {
                  top: -18,
                  left: -18,
                  width: 44,
                  height: 44,
                  borderRadius: 6,
                  backgroundColor: Gallery.destructiveFill,
                },
              ]}
            >
              <Image source="sf:minus.circle.fill" style={{ width: 20, height: 20 }} tintColor={Gallery.destructive} />
            </Pressable>
            <GestureDetector gesture={resize}>
              <Animated.View
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel="Artwork size"
                accessibilityHint="Drag to resize artwork."
                accessibilityValue={{
                  min: 16,
                  max: 90,
                  now: Math.round(layout.width * 100),
                  text: `${Math.round(layout.width * 100)} percent of wall width`,
                }}
                accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                onAccessibilityAction={({ nativeEvent }) =>
                  onMove?.(
                    piece.localId,
                    constrainLayout(layout, {
                      width: layout.width + (nativeEvent.actionName === "increment" ? 0.04 : -0.04),
                    }),
                  )
                }
                style={[
                  styles.editBadge,
                  {
                    top: undefined,
                    bottom: 18,
                    right: -12,
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                  },
                ]}
              >
                <Image
                  source="sf:arrow.up.left.and.arrow.down.right"
                  style={{ width: 13, height: 13 }}
                  tintColor={Gallery.surface}
                />
              </Animated.View>
            </GestureDetector>
          </>
        )}
      </Animated.View>
    </Animated.View>
  );
  return editing ? <GestureDetector gesture={pan}>{hanging}</GestureDetector> : hanging;
}

const styles = StyleSheet.create({
  label: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingTop: 8,
  },
  artist: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  title: { fontSize: 12, lineHeight: 16 },
  editBadge: {
    position: "absolute",
    top: -10,
    right: -10,
    width: 26,
    height: 26,
    backgroundColor: Gallery.accent,
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
});
