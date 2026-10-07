import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { Motion } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

import { ReactionIcon } from "./reaction-icon";

const POP_EASING = Easing.bezier(...Motion.easeOut);

export function playLikeHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// `liked` is undefined while it loads, so only a heart that turns on from a known unliked state pops.
export function LikeHeart({ liked, size, color }: { liked: boolean | undefined; size?: number; color?: string }) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const previous = useRef(liked);
  useEffect(() => {
    if (previous.current === false && liked && !reduced) {
      scale.set(
        withSequence(
          withTiming(1.25, { duration: 110, easing: POP_EASING }),
          withTiming(0.94, { duration: 100, easing: POP_EASING }),
          withTiming(1, { duration: 80, easing: POP_EASING }),
        ),
      );
    }
    previous.current = liked;
  }, [liked, reduced, scale]);
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <Animated.View style={pop}>
      <ReactionIcon kind="heart" filled={!!liked} size={size} color={color} />
    </Animated.View>
  );
}
