import { useState } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useScrollOffset,
  useSharedValue,
  type AnimatedRef,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Spacing } from "@/constants/theme";

const FADE = Spacing.five;

type Edge = { offset: SharedValue<number>; wallTop: SharedValue<number> };

/** 0 until the wall's top edge comes within the fade of the screen's top, rising to 1 as it reaches the top. */
function wallProgress({ offset, wallTop }: Edge) {
  "worklet";
  const top = wallTop.get();
  if (!Number.isFinite(top)) return 0;
  return interpolate(offset.get(), [top - FADE, top], [0, 1], Extrapolation.CLAMP);
}

/**
 * Follows the wall's top edge as it scrolls up to the status bar. Set `wallTop` to the wall's offset in the scroll
 * content, infinite while no wall shows. `darkTop` turns on once a dark wall fills the top of the screen.
 */
export function useWallScrollEdge(scroll: AnimatedRef<Animated.ScrollView>, color: string, dark: boolean) {
  const offset = useScrollOffset(scroll);
  const wallTop = useSharedValue(Number.POSITIVE_INFINITY);
  const [underTop, setUnderTop] = useState(false);
  useAnimatedReaction(
    () => wallProgress({ offset, wallTop }) >= 0.5,
    (under, previous) => {
      if (under !== previous) scheduleOnRN(setUnderTop, under);
    },
  );
  return { edge: { offset, wallTop, color }, darkTop: dark && underTop };
}

type WallEdge = ReturnType<typeof useWallScrollEdge>["edge"];

/**
 * Paints the status bar area, `height` points above the pane, in the wall's color as the wall reaches it, with a short
 * fade below so the wall runs to the top of the screen instead of meeting a paper strip.
 */
export function WallTopEdge({ edge, height }: { edge: WallEdge; height: number }) {
  const tint = useAnimatedStyle(() => ({ opacity: wallProgress(edge) }));
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[styles.layer, { top: -height, height, backgroundColor: edge.color }, tint]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.layer,
          {
            top: 0,
            height: FADE,
            experimental_backgroundImage: `linear-gradient(to bottom, ${edge.color} 0%, ${edge.color}00 100%)`,
          },
          tint,
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", left: 0, right: 0 },
});
