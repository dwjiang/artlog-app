import type { Icon } from "@expo/ui";
import { useNativeState } from "@expo/ui/swift-ui";
import { symbolEffect } from "@expo/ui/swift-ui/modifiers";
import { useEffect, useRef, type ComponentProps } from "react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * Icon modifiers that bounce an SF Symbol each time `key` changes from one known value to another, so a screen opening
 * on a loaded or loading (undefined) value never bounces. The trigger moves a frame after the change, once a newly shown
 * symbol is mounted and the new `direction` has reached it.
 */
export function useSymbolBounce(
  key: number | boolean | undefined,
  direction: "up" | "down" = "up",
): ComponentProps<typeof Icon>["modifiers"] {
  const reduced = useReducedMotion();
  const trigger = useNativeState(0);
  const previous = useRef(key);
  useEffect(() => {
    const changed = previous.current !== undefined && key !== undefined && previous.current !== key;
    previous.current = key;
    if (!changed) return;
    const frame = requestAnimationFrame(() => trigger.set(trigger.get() + 1));
    return () => cancelAnimationFrame(frame);
  }, [trigger, key]);
  return reduced ? [] : [symbolEffect({ effect: "bounce", direction }, { value: trigger })];
}

/** Bounces a toggle's symbol up as it turns on and down as it turns off; `on` is undefined while it loads. */
export function useToggleBounce(on: boolean | undefined) {
  return useSymbolBounce(on, on ? "up" : "down");
}
