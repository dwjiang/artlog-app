import { forwardRef, useState } from "react";
import { Pressable, StyleSheet, type PressableProps, type View } from "react-native";
import { createAnimatedComponent, cubicBezier } from "react-native-reanimated";

import { Motion } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const AnimatedPressable = createAnimatedComponent(Pressable);
const PRESS_EASING = cubicBezier(...Motion.easeOut);

export const MotionPressable = forwardRef<View, PressableProps>(function MotionPressable(
  { children, disabled, onPressIn, onPressOut, style, testOnly_pressed, ...props },
  ref,
) {
  const reduced = useReducedMotion();
  const [press, setPress] = useState({ held: false, disabled: !!disabled });
  // Disabling can cancel a touch before native press-out reaches the control.
  if (press.disabled !== !!disabled) setPress({ held: false, disabled: !!disabled });
  const pressed = !disabled && (press.held || !!testOnly_pressed);
  const base = StyleSheet.flatten(typeof style === "function" ? style({ pressed, hovered: false }) : style);
  const scale = pressed ? 0.97 : 1;
  const transform =
    reduced || disabled
      ? base?.transform
      : typeof base?.transform === "string"
        ? `${base.transform} scale(${scale})`
        : [...(base?.transform ?? []), { scale }];

  return (
    <AnimatedPressable
      {...props}
      ref={ref}
      disabled={disabled}
      testOnly_pressed={testOnly_pressed}
      onPressIn={(event) => {
        setPress({ held: true, disabled: !!disabled });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPress({ held: false, disabled: !!disabled });
        onPressOut?.(event);
      }}
      style={[
        base,
        {
          transform,
          opacity: reduced && pressed ? (typeof base?.opacity === "number" ? base.opacity : 1) * 0.72 : base?.opacity,
          transitionProperty: reduced ? "opacity" : "transform",
          transitionDuration: Motion.press,
          transitionTimingFunction: PRESS_EASING,
        },
      ]}
    >
      {children}
    </AnimatedPressable>
  );
});
