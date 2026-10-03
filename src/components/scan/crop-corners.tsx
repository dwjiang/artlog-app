import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Gallery } from "@/constants/theme";
import { fitPhoto, moveCropCorner } from "@/lib/capture/crop-geometry";
import type { Quad } from "@/lib/capture/stages";

const labels = ["Top left", "Top right", "Bottom right", "Bottom left"];
export function CropCorners({
  uri,
  size,
  corners,
  onChange,
  onDragStart,
  onDragEnd,
  disabled = false,
}: {
  uri: string;
  size: { width: number; height: number };
  corners: Quad;
  onChange: (corners: Quad) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  disabled?: boolean;
}) {
  const [frame, setFrame] = useState({ width: 1, height: 1 });
  const photo = fitPhoto(size, frame);
  const live = useSharedValue(corners);
  useEffect(() => live.set(corners), [corners, live]);
  return (
    <GestureHandlerRootView style={styles.canvas} onLayout={({ nativeEvent: { layout } }) => setFrame(layout)}>
      <Image
        cachePolicy="memory"
        source={uri}
        contentFit="contain"
        style={StyleSheet.absoluteFill}
        accessibilityLabel="Full photo for crop adjustment"
      />
      <View style={{ position: "absolute", ...photo }}>
        {corners.map((_, index) => (
          <Edge key={`edge-${index}`} index={index} live={live} width={photo.width} height={photo.height} />
        ))}
        {corners.map((_, i) => (
          <Corner
            key={i}
            index={i}
            corners={corners}
            live={live}
            width={photo.width}
            height={photo.height}
            onChange={onChange}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            disabled={disabled}
          />
        ))}
      </View>
    </GestureHandlerRootView>
  );
}

function Edge({
  index,
  live,
  width,
  height,
}: {
  index: number;
  live: SharedValue<Quad>;
  width: number;
  height: number;
}) {
  const style = useAnimatedStyle(() => {
    const points = live.get();
    const [x, y] = points[index];
    const next = points[(index + 1) % 4];
    const dx = (next[0] - x) * width;
    const dy = (next[1] - y) * height;
    return {
      transform: [
        { translateX: x * width },
        { translateY: y * height },
        { rotate: `${Math.atan2(dy, dx)}rad` },
        { scaleX: Math.hypot(dx, dy) },
      ],
    };
  });
  return <Animated.View pointerEvents="none" style={[styles.edge, style]} />;
}

function Corner({
  index,
  corners,
  live,
  width,
  height,
  onChange,
  onDragStart,
  onDragEnd,
  disabled,
}: {
  index: number;
  corners: Quad;
  live: SharedValue<Quad>;
  width: number;
  height: number;
  onChange: (quad: Quad) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  disabled: boolean;
}) {
  const start = useSharedValue(corners);
  const [x, y] = corners[index];
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .withTestId(`crop-corner-${index}`)
        .enabled(!disabled)
        .minDistance(0)
        .maxPointers(1)
        .onBegin(() => {
          start.set(live.get());
          if (onDragStart) scheduleOnRN(onDragStart);
        })
        .onUpdate((event) => {
          const point = start.get()[index];
          live.set(
            moveCropCorner(
              live.get(),
              index,
              point[0] + event.translationX / width,
              point[1] + event.translationY / height,
            ),
          );
        })
        .onEnd((event, success) => {
          if (!success) return;
          const point = start.get()[index];
          const next = moveCropCorner(
            live.get(),
            index,
            point[0] + event.translationX / width,
            point[1] + event.translationY / height,
          );
          live.set(next);
          scheduleOnRN(onChange, next);
        })
        .onFinalize((_event, success) => {
          if (!success) live.set(start.get());
          if (onDragEnd) scheduleOnRN(onDragEnd);
        }),
    [disabled, height, index, live, onChange, onDragEnd, onDragStart, start, width],
  );
  const style = useAnimatedStyle(() => {
    const point = live.get()[index];
    return { transform: [{ translateX: point[0] * width }, { translateY: point[1] * height }] };
  });
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessible
        accessibilityRole="adjustable"
        accessibilityState={{ disabled }}
        accessibilityLabel={`${labels[index]} corner`}
        accessibilityHint="Drag to the painting corner, or use actions to move it."
        accessibilityValue={{
          text: `${Math.round(x * 100)} percent across, ${Math.round(y * 100)} percent down`,
        }}
        accessibilityActions={[
          { name: "left", label: "Move left" },
          { name: "right", label: "Move right" },
          { name: "up", label: "Move up" },
          { name: "down", label: "Move down" },
        ]}
        onAccessibilityAction={({ nativeEvent: { actionName } }) => {
          if (disabled) return;
          const point = live.get()[index];
          const next = moveCropCorner(
            live.get(),
            index,
            point[0] + (actionName === "left" ? -0.01 : actionName === "right" ? 0.01 : 0),
            point[1] + (actionName === "up" ? -0.01 : actionName === "down" ? 0.01 : 0),
          );
          live.set(next);
          onChange(next);
        }}
        style={[styles.handle, style]}
      >
        <View style={styles.dot} />
      </Animated.View>
    </GestureDetector>
  );
}
const styles = StyleSheet.create({
  canvas: { flex: 1 },
  edge: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 1,
    height: 2,
    backgroundColor: Gallery.accent,
    transformOrigin: "left center",
  },
  handle: {
    position: "absolute",
    left: -24,
    top: -24,
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: Gallery.surface,
    backgroundColor: Gallery.accent,
    boxShadow: "0 1px 5px #0006",
  },
});
