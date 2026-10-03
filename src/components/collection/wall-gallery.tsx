import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { PixelRatio, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, type NativeGesture } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";
import {
  constrainWallPiece,
  dropWallPiece,
  isLightWall,
  resizeWallLayout,
  wallPieceBounds,
  wallBottom,
  type WallArrangement,
  type WallCorner,
  type WallLayout,
  type WallPiece,
  type Wallpaper,
} from "@/lib/wall/wall-layout";

import { WallArtwork } from "./wall-artwork";
import { wallpaperStyle } from "./wallpaper";

const corners: WallCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
// A drag resting this long, within this many points, previews where every artwork will hang on release.
const DWELL_MS = 200;
const DWELL_SLOP = 6;
const LIFT = 0.03;
// Reanimated's default spring: duration-based springs reach 90% within a third of their duration, which reads as a
// jump when an artwork crosses the wall.
const SPRING = { reduceMotion: ReduceMotion.System };
const PIXEL = PixelRatio.get();

type Placement = Pick<WallLayout, "x" | "y" | "width">;
type Drag = { id: string; x: number; y: number };

function samePlacement(a: Placement, b: Placement) {
  "worklet";
  return a.x === b.x && a.y === b.y && a.width === b.width;
}

function tick() {
  void Haptics.selectionAsync().catch(() => {});
}

export function WallGallery({
  pieces,
  wallpaper,
  width,
  minHeight = pieces.length > 0 ? 580 : 440,
  editing = false,
  locked = false,
  bottomInset = 0,
  backgroundBottomInset = 0,
  onSelect,
  onArrange,
  selectedId,
  scrollGesture,
  onDeselect,
  children,
}: {
  pieces: WallPiece[];
  wallpaper: Wallpaper;
  width: number;
  editing?: boolean;
  locked?: boolean;
  selectedId?: string;
  scrollGesture?: NativeGesture;
  onDeselect?: () => void;
  minHeight?: number;
  bottomInset?: number;
  backgroundBottomInset?: number;
  onSelect: (piece: WallPiece) => void;
  // Returns whether the wall saved the arrangement; artworks in an unsaved one glide back.
  onArrange?: (arrangement: WallArrangement) => boolean;
  children?: React.ReactNode;
}) {
  const light = isLightWall(wallpaper.color);
  // Placements the wall has not saved yet: a resting drag's preview, then the release until the save lands.
  const arrangement = useSharedValue<WallArrangement>({});
  const drag = useSharedValue<Drag | null>(null);
  const rest = useSharedValue({ id: "", x: 0, y: 0, since: 0, shown: true });
  const preview = useFrameCallback(({ timestamp }) => {
    const current = drag.get();
    if (!current) return;
    const anchor = rest.get();
    if (anchor.id !== current.id || Math.hypot(current.x - anchor.x, current.y - anchor.y) * width > DWELL_SLOP) {
      rest.set({ ...current, since: timestamp, shown: false });
    } else if (!anchor.shown && timestamp - anchor.since >= DWELL_MS) {
      rest.set({ ...anchor, shown: true });
      const next = dropWallPiece(pieces, current.id, current, width);
      const before = arrangement.get();
      if (Object.keys(next).some((id) => id !== current.id && !(before[id] && samePlacement(before[id], next[id])))) {
        scheduleOnRN(tick);
      }
      arrangement.set(next);
    }
  }, false);
  useEffect(() => {
    preview.setActive(editing && !locked);
  }, [preview, editing, locked]);
  useEffect(() => {
    const saved = Object.fromEntries(pieces.map((piece) => [piece.localId, piece.layout]));
    scheduleOnUI(() => {
      const current = arrangement.get();
      const unsaved = Object.fromEntries(
        Object.entries(current).filter(([id, layout]) => saved[id] && !samePlacement(layout, saved[id])),
      );
      if (Object.keys(unsaved).length < Object.keys(current).length) arrangement.set(unsaved);
    });
  }, [pieces, arrangement]);

  function arrange(next: WallArrangement) {
    if (!onArrange?.(next)) arrangement.set({});
  }

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
          movable={editing && !locked && !!onArrange}
          selected={selectedId === piece.localId}
          labelColor={light ? Gallery.ink : Gallery.paper}
          arrangement={arrangement}
          drag={drag}
          onSelect={onSelect}
          onArrange={arrange}
        />
      ))}
      {children}
    </View>
  );
}

// Each artwork hangs where these values say, never where React last laid it out, so a save that changes its layout
// cannot flash it out of place mid-animation.
function usePlacement(layout: WallLayout) {
  const x = useSharedValue(layout.x);
  const y = useSharedValue(layout.y);
  const size = useSharedValue(layout.width);
  const goal = useSharedValue<Placement>({ x: layout.x, y: layout.y, width: layout.width });
  const lift = useSharedValue(0);
  const dragging = useSharedValue(false);
  function glide(target: Placement, velocity?: { x: number; y: number }) {
    "worklet";
    goal.set({ x: target.x, y: target.y, width: target.width });
    x.set(withSpring(target.x, { ...SPRING, velocity: velocity?.x ?? 0 }));
    y.set(withSpring(target.y, { ...SPRING, velocity: velocity?.y ?? 0 }));
    size.set(withSpring(target.width, SPRING));
  }
  function jump(target: Placement) {
    "worklet";
    goal.set({ x: target.x, y: target.y, width: target.width });
    x.set(target.x);
    y.set(target.y);
    size.set(target.width);
  }
  return { x, y, size, goal, lift, dragging, glide, jump };
}

type HangingPlacement = ReturnType<typeof usePlacement>;

function Hanging({
  piece,
  pieces,
  scrollGesture,
  width,
  editing,
  movable,
  labelColor,
  arrangement,
  drag,
  onSelect,
  onArrange,
  selected,
}: {
  piece: WallPiece;
  pieces: WallPiece[];
  scrollGesture?: NativeGesture;
  width: number;
  editing: boolean;
  movable: boolean;
  labelColor: string;
  selected: boolean;
  arrangement: SharedValue<WallArrangement>;
  drag: SharedValue<Drag | null>;
  onSelect: (piece: WallPiece) => void;
  onArrange: (arrangement: WallArrangement) => void;
}) {
  const { layout } = piece;
  const placement = usePlacement(layout);
  const { x, y, size, goal, lift, dragging, glide } = placement;
  const origin = useSharedValue({ x: layout.x, y: layout.y });
  const artworkWidth = layout.width * width;
  const artworkHeight = wallPieceBounds(piece, width).height * width;
  useAnimatedReaction(
    () => arrangement.get()[piece.localId] ?? layout,
    (target) => {
      if (!dragging.get() && !samePlacement(target, goal.get())) glide(target);
    },
  );
  function follow(event: { translationX: number; translationY: number }) {
    "worklet";
    const start = origin.get();
    const next = {
      id: piece.localId,
      x: start.x + event.translationX / width,
      y: start.y + event.translationY / width,
    };
    x.set(next.x);
    y.set(next.y);
    drag.set(next);
    return next;
  }
  const pan = Gesture.Pan()
    .withTestId(`move-${piece.localId}`)
    .enabled(movable)
    .minDistance(3)
    // The outer padding belongs to the resize handles; blank wall remains available for scrolling.
    .hitSlop(-22)
    .blocksExternalGesture(...(scrollGesture ? [scrollGesture] : []))
    .onBegin(() => {
      origin.set({ x: x.get(), y: y.get() });
    })
    .onStart(() => {
      dragging.set(true);
      lift.set(withSpring(1, SPRING));
      scheduleOnRN(onSelect, piece);
    })
    .onUpdate((event) => {
      follow(event);
    })
    .onEnd((event, success) => {
      if (!success) return;
      const next = dropWallPiece(pieces, piece.localId, follow(event), width);
      glide(next[piece.localId] ?? layout, { x: event.velocityX / width, y: event.velocityY / width });
      arrangement.set(next);
      scheduleOnRN(onArrange, next);
    })
    .onFinalize((_event, success) => {
      if (!dragging.get()) return;
      dragging.set(false);
      lift.set(withSpring(0, SPRING));
      drag.set(null);
      if (!success) {
        glide(layout);
        arrangement.set({});
      }
    });
  const place = useAnimatedStyle(() => ({
    transform: [
      { translateX: Math.round((x.get() * width - 22) * PIXEL) / PIXEL },
      { translateY: Math.round((y.get() * width - 22) * PIXEL) / PIXEL },
    ],
    zIndex: dragging.get() ? 101 : editing && selected ? 100 : layout.layer,
    opacity: dragging.get() ? 0.92 : 1,
  }));
  // Sizes the artwork from wall-width units; a lifted artwork grows from its center.
  const grow = useAnimatedStyle(() => {
    const current = size.get();
    const scale = 1 + LIFT * lift.get();
    const { height } = wallPieceBounds({ ...piece, layout: { ...layout, width: current } }, width);
    return {
      transform: [
        { translateX: ((1 - scale) * current * width) / 2 },
        { translateY: ((1 - scale) * height * width) / 2 },
        { scale: current * scale },
      ],
    };
  });
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.hanging, { width: artworkWidth + 44 }, place]}>
        <Pressable
          accessibilityRole={editing && selected ? "adjustable" : "button"}
          accessibilityLabel={`${piece.artwork.title}, ${piece.artwork.artist}`}
          accessibilityState={{ selected: editing && selected }}
          accessibilityHint={
            editing
              ? "Drag to move. Drop on another artwork to swap them. Swipe empty wall space to scroll. Drag any corner to resize. Tap empty wall space to deselect."
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
            if (!movable || !selected) return;
            const patches: Record<string, Partial<WallLayout>> = {
              increment: { width: layout.width + 0.04 },
              decrement: { width: layout.width - 0.04 },
              moveLeft: { x: layout.x - 0.025 },
              moveRight: { x: layout.x + 0.025 },
              moveUp: { y: layout.y - 0.025 },
              moveDown: { y: layout.y + 0.025 },
            };
            if (patches[actionName]) {
              onArrange({ [piece.localId]: constrainWallPiece(piece, patches[actionName], pieces, width) });
            }
          }}
          onPress={() => onSelect(piece)}
        >
          <Animated.View style={[styles.scaled, grow]}>
            {/* Renders at the saved size in wall-width units, changing in the same commit as that size. */}
            <View style={[styles.scaled, { transform: [{ scale: 1 / layout.width }] }]}>
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
            </View>
          </Animated.View>
        </Pressable>
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
              enabled={movable}
              pan={pan}
              pieces={pieces}
              scrollGesture={scrollGesture}
              placement={placement}
              arrangement={arrangement}
              onArrange={onArrange}
            />
          ))}
      </Animated.View>
    </GestureDetector>
  );
}

function ResizeCorner({
  corner,
  piece,
  wallWidth,
  artworkWidth,
  artworkHeight,
  enabled,
  pan,
  pieces,
  scrollGesture,
  placement,
  arrangement,
  onArrange,
}: {
  corner: WallCorner;
  piece: WallPiece;
  wallWidth: number;
  artworkWidth: number;
  artworkHeight: number;
  enabled: boolean;
  pan: ReturnType<typeof Gesture.Pan>;
  pieces: WallPiece[];
  scrollGesture?: NativeGesture;
  placement: HangingPlacement;
  arrangement: SharedValue<WallArrangement>;
  onArrange: (arrangement: WallArrangement) => void;
}) {
  const { layout } = piece;
  const left = corner.endsWith("left");
  const top = corner.startsWith("top");
  function resized(event: { translationX: number; translationY: number }) {
    "worklet";
    const next = resizeWallLayout(
      layout,
      corner,
      { x: event.translationX / wallWidth, y: event.translationY / wallWidth },
      artworkWidth / artworkHeight,
    );
    const current = { ...layout, x: placement.x.get(), y: placement.y.get(), width: placement.size.get() };
    const constrained = constrainWallPiece({ ...piece, layout: current }, next, pieces, wallWidth);
    placement.jump(constrained);
    return constrained;
  }
  const resize = Gesture.Pan()
    .withTestId(`resize-${piece.localId}-${corner}`)
    .enabled(enabled)
    .minDistance(0)
    .blocksExternalGesture(pan, ...(scrollGesture ? [scrollGesture] : []))
    .onUpdate((event) => {
      resized(event);
    })
    .onEnd((event, success) => {
      if (!success) return;
      const next = { [piece.localId]: resized(event) };
      arrangement.set(next);
      scheduleOnRN(onArrange, next);
    })
    .onFinalize((_event, success) => {
      if (!success) placement.glide(layout);
    });
  const position = useAnimatedStyle(() => {
    const current = placement.size.get();
    const { height } = wallPieceBounds({ ...piece, layout: { ...layout, width: current } }, wallWidth);
    return {
      opacity: placement.dragging.get() ? 0 : 1,
      transform: [{ translateX: left ? 0 : current * wallWidth }, { translateY: top ? 0 : height * wallWidth }],
    };
  });
  return (
    <GestureDetector gesture={resize}>
      <Animated.View accessible={false} testID={`resize-${corner}`} style={[styles.cornerTarget, position]}>
        <View style={styles.cornerDot} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hanging: { position: "absolute", left: 0, top: 0, padding: 22 },
  scaled: { transformOrigin: "top left", pointerEvents: "none" },
  label: { marginTop: 14, gap: 2 },
  artist: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  title: { fontSize: 12, lineHeight: 16 },
  cornerTarget: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  cornerDot: {
    width: 9,
    height: 9,
    backgroundColor: Gallery.paper,
    borderWidth: 1.5,
    borderColor: Gallery.accent,
    borderRadius: 2,
  },
});
