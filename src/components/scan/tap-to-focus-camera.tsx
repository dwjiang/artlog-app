import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { Camera, type CameraRef, type CameraViewProps } from "react-native-vision-camera";

import { Colors, Motion } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { reportError } from "@/lib/observability";

import { recordCameraFailure } from "./camera-diagnostics";

const SQUARE_SIZE = 76;
const LINE = 1;
const TICK = 6;
const easeOut = cubicBezier(...Motion.easeOut);
// The Camera app's focus box blinks while it focuses, then dims before it goes.
const blink = {
  from: { opacity: 1 },
  "12%": { opacity: 1 },
  "25%": { opacity: 0.5 },
  "38%": { opacity: 1 },
  "50%": { opacity: 0.5 },
  "85%": { opacity: 0.5 },
  to: { opacity: 0 },
};
const settle = {
  ...blink,
  from: { opacity: 1, transform: [{ scale: 1.5 }] },
  "12%": { opacity: 1, transform: [{ scale: 1 }] },
};

/**
 * A full-bleed camera preview that focuses and meters where it is tapped, as the Camera app does. Overlays above it
 * must let taps through (`box-none`) wherever they draw nothing.
 */
export function TapToFocusCamera(props: Omit<CameraViewProps, "ref" | "style" | "onSubjectAreaChanged">) {
  const camera = useRef<CameraRef>(null);
  const currentRequest = useRef<symbol>(undefined);
  const [focus, setFocus] = useState<{ x: number; y: number; tap: number }>();
  const reduced = useReducedMotion();
  useEffect(
    () => () => {
      currentRequest.current = undefined;
    },
    [props.isActive],
  );

  function resetFocus() {
    // Invalidate first: resetting rejects any pending metering request as canceled.
    currentRequest.current = undefined;
    setFocus(undefined);
    camera.current?.resetFocus().catch((error) => reportError(error, "camera.reset_focus"));
  }

  return (
    <Pressable
      testID="camera-preview"
      accessible={false}
      disabled={!props.isActive}
      style={StyleSheet.absoluteFill}
      onPress={({ nativeEvent: { locationX: x, locationY: y } }) => {
        const request = Symbol();
        currentRequest.current = request;
        setFocus((previous) => ({ x, y, tap: (previous?.tap ?? 0) + 1 }));
        camera.current?.focusTo({ x, y }, { autoResetAfter: null }).catch((error: unknown) => {
          if (currentRequest.current !== request) return;
          // VisionCamera's iOS metering errors expose messages, not error codes.
          const message = error instanceof Error ? error.message : "";
          if (message.includes("The metering operation has been canceled!")) return;
          if (!message.includes("The metering operation has timeouted!")) reportError(error, "camera.focus");
          // A timeout leaves iOS in one-shot metering mode instead of continuous autofocus.
          resetFocus();
        });
      }}
    >
      <Camera
        {...props}
        onError={
          props.onError
            ? (error) => {
                recordCameraFailure(props);
                props.onError?.(error);
              }
            : undefined
        }
        ref={camera}
        style={StyleSheet.absoluteFill}
        // The tapped point holds until the view moves on, then focus returns to the center.
        onSubjectAreaChanged={() => {
          if (!focus) return;
          resetFocus();
        }}
      />
      {focus && (
        <Animated.View
          key={focus.tap}
          pointerEvents="none"
          style={[
            styles.square,
            { left: focus.x - SQUARE_SIZE / 2, top: focus.y - SQUARE_SIZE / 2 },
            {
              animationName: reduced ? blink : settle,
              animationDuration: 2000,
              animationTimingFunction: easeOut,
              animationFillMode: "forwards",
            },
          ]}
        >
          <View style={[styles.tick, styles.vertical, { top: 0 }]} />
          <View style={[styles.tick, styles.vertical, { bottom: 0 }]} />
          <View style={[styles.tick, styles.horizontal, { left: 0 }]} />
          <View style={[styles.tick, styles.horizontal, { right: 0 }]} />
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  square: {
    position: "absolute",
    width: SQUARE_SIZE,
    height: SQUARE_SIZE,
    borderWidth: LINE,
    borderColor: Colors.light.cameraFocus,
  },
  tick: { position: "absolute", backgroundColor: Colors.light.cameraFocus },
  vertical: { left: "50%", marginLeft: -LINE / 2, width: LINE, height: TICK },
  horizontal: { top: "50%", marginTop: -LINE / 2, width: TICK, height: LINE },
});
