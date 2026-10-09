import { useEffect, useRef, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";

import { Motion } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const POP_EASING = Easing.bezier(...Motion.easeOut);

// `on` is undefined while it loads, so only a change from a known off state pops: never a screen opening on it.
function usePop(on: boolean | undefined) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const previous = useRef(on);
  useEffect(() => {
    if (previous.current === false && on && !reduced) {
      scale.set(
        withSequence(
          withTiming(1.25, { duration: 110, easing: POP_EASING }),
          withTiming(0.94, { duration: 100, easing: POP_EASING }),
          withTiming(1, { duration: 80, easing: POP_EASING }),
        ),
      );
    }
    previous.current = on;
  }, [on, reduced, scale]);
  return useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
}

/** Wraps a glyph that switches between off and on, such as a heart or a checkbox, and pops it when it turns on. */
export function PopOnTurnOn({
  on,
  style,
  children,
}: {
  on: boolean | undefined;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const pop = usePop(on);
  return <Animated.View style={[style, pop]}>{children}</Animated.View>;
}

/** A badge shown only while `on`, which pops in when it turns on. */
export function PopInBadge({
  on,
  style,
  children,
}: {
  on: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const pop = usePop(on);
  return on ? (
    <Animated.View pointerEvents="none" style={[style, pop]}>
      {children}
    </Animated.View>
  ) : null;
}
