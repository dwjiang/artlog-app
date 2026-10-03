import { StyleSheet, useWindowDimensions } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, FadeOutDown, ReduceMotion } from "react-native-reanimated";

import { Gallery, Motion, Radius, Spacing, Typography } from "@/constants/theme";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

import { LoadingRing } from "./loading-ring";
import { MotionPressable } from "./motion-pressable";
import { ThemedText } from "./themed-text";

const easeOut = Easing.bezier(0.23, 1, 0.32, 1);
const enter = FadeInDown.duration(Motion.enter).easing(easeOut).reduceMotion(ReduceMotion.System);
const exit = FadeOutDown.duration(Motion.exit).easing(easeOut).reduceMotion(ReduceMotion.System);
const fadeIn = FadeIn.duration(Motion.state).easing(easeOut).reduceMotion(ReduceMotion.Never);
const fadeOut = FadeOut.duration(Motion.press).easing(easeOut).reduceMotion(ReduceMotion.Never);

export function ToastPill({
  message,
  actions,
  busy = false,
}: {
  message: string;
  actions?: { label: string; onPress: () => void }[];
  busy?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const reduced = useReducedMotion();
  return (
    <Animated.View
      entering={reduced ? fadeIn : enter}
      exiting={reduced ? fadeOut : exit}
      style={[styles.pill, fontScale >= 1.5 && styles.stacked, busy && styles.busy]}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy }}
    >
      {busy ? (
        <LoadingRing accessibilityLabel={message} color={Gallery.surface} />
      ) : (
        <ThemedText variant="secondary" accessibilityRole="alert" style={styles.message}>
          {message}
        </ThemedText>
      )}
      {actions?.map((action) => (
        <MotionPressable
          key={action.label}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: busy, busy }}
          disabled={busy}
          onPress={action.onPress}
          style={[styles.action, { opacity: busy ? 0.6 : 1 }]}
        >
          <ThemedText style={styles.actionLabel}>{action.label}</ThemedText>
        </MotionPressable>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    minWidth: 180,
    maxWidth: "100%",
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.input,
    borderCurve: "continuous",
    backgroundColor: Gallery.ink,
  },
  stacked: { flexDirection: "column", alignItems: "stretch" },
  busy: { justifyContent: "center" },
  message: { flexShrink: 1, color: Gallery.surface },
  action: { minWidth: 44, minHeight: 44, justifyContent: "center" },
  actionLabel: {
    ...Typography.secondary,
    fontWeight: "600",
    color: Gallery.surface,
    textDecorationLine: "underline",
  },
});
