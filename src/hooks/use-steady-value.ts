import { useEffect } from "react";
import { cancelAnimation, Easing, useSharedValue, withTiming } from "react-native-reanimated";

import { useReducedMotion } from "@/hooks/use-reduced-motion";

/** Follows a value reported in steps by sweeping linearly to each new one over `duration`, the expected step interval. */
export function useSteadyValue(target: number, duration: number) {
  const reduced = useReducedMotion();
  const value = useSharedValue(target);
  useEffect(() => {
    value.set(withTiming(target, { duration: reduced ? 0 : duration, easing: Easing.linear }));
    return () => cancelAnimation(value);
  }, [value, target, duration, reduced]);
  return value;
}
