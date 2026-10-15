import { useEffect, useRef, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { Motion } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const POP_EASING = Easing.bezier(...Motion.easeOut);
const SHRINK_OUT = new Keyframe({
  0: { opacity: 1, transform: [{ scale: 1 }] },
  100: { opacity: 0, transform: [{ scale: 0.6 }], easing: POP_EASING },
}).duration(150);

// `on` is undefined while it loads, so only a change from a known state animates: never a screen opening on it.
function usePop(on: boolean | undefined, dipOnTurnOff = false) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const previous = useRef(on);
  useEffect(() => {
    const was = previous.current;
    previous.current = on;
    if (reduced || was === undefined || on === undefined || was === on) return;
    if (on) {
      scale.set(
        withSequence(
          withTiming(1.25, { duration: 110, easing: POP_EASING }),
          withTiming(0.94, { duration: 100, easing: POP_EASING }),
          withTiming(1, { duration: 80, easing: POP_EASING }),
        ),
      );
    } else if (dipOnTurnOff) {
      scale.set(
        withSequence(
          withTiming(0.8, { duration: 100, easing: POP_EASING }),
          withTiming(1, { duration: 140, easing: POP_EASING }),
        ),
      );
    }
  }, [on, reduced, scale, dipOnTurnOff]);
  return useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
}

/**
 * Wraps a glyph that switches between off and on, such as a heart or a checkbox, and pops it when it turns on. With
 * `dipOnTurnOff`, for a glyph still shown when off, it also shrinks back briefly when it turns off.
 */
export function PopOnTurnOn({
  on,
  dipOnTurnOff,
  style,
  children,
}: {
  on: boolean | undefined;
  dipOnTurnOff?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const pop = usePop(on, dipOnTurnOff);
  return <Animated.View style={[style, pop]}>{children}</Animated.View>;
}

/** A badge shown only while `on`, which pops in when it turns on and shrinks away when it turns off. */
export function PopInBadge({
  on,
  style,
  children,
}: {
  on: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const pop = usePop(on);
  return on ? (
    <Animated.View pointerEvents="none" exiting={reduced ? undefined : SHRINK_OUT} style={[style, pop]}>
      {children}
    </Animated.View>
  ) : null;
}
