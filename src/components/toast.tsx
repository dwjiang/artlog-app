import { useSegments } from "expo-router";
import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomTabInset, Spacing } from "@/constants/theme";
import { dismissToast, useToast, useToastLift, type ToastLift } from "@/lib/ui/toast";

import { ToastPill } from "./toast-pill";

/** Floats the current toast (and any extra pills passed as children) above the bottom edge; screens report outcomes through
 *  `showToast` instead of inline banners. Natively presented sheets cover the root layer, so a flow inside one mounts its own.
 *  Without an explicit offset the layer clears the tab bar only while a tab is focused; root-stack screens cover the tabs. */
export function ToastLayer({ children, offset }: { children?: ReactNode; offset?: number }) {
  return offset === undefined ? (
    <RoutedToastLayer>{children}</RoutedToastLayer>
  ) : (
    <PositionedToastLayer offset={offset}>{children}</PositionedToastLayer>
  );
}

function RoutedToastLayer({ children }: { children?: ReactNode }) {
  const [root] = useSegments();
  return (
    <PositionedToastLayer offset={root === "(tabs)" ? BottomTabInset : 0} lifted>
      {children}
    </PositionedToastLayer>
  );
}

function PositionedToastLayer({
  children,
  offset,
  lifted = false,
}: {
  children?: ReactNode;
  offset: number;
  lifted?: boolean;
}) {
  const toast = useToast();
  const { bottom } = useSafeAreaInsets();
  const lift = useToastLift();
  const [measured, setMeasured] = useState<{ id?: number; height: number }>();
  const resting = bottom + offset + Spacing.content;
  const position = lifted
    ? toastLayerBottom(resting, lift, measured?.id === toast?.id ? measured?.height : undefined)
    : resting;
  return (
    // Keyed by toast so each new one is measured before the room under a raised bar is trusted with it.
    <View
      key={toast?.id}
      pointerEvents="box-none"
      onLayout={({ nativeEvent: { layout } }) => setMeasured({ id: toast?.id, height: layout.height })}
      style={[styles.layer, position === undefined ? { bottom: resting, opacity: 0 } : { bottom: position }]}
    >
      {children}
      {toast && (
        <ToastPill
          key={toast.id}
          message={toast.message}
          actions={
            toast.action
              ? [
                  {
                    label: toast.action.label,
                    onPress: () => {
                      toast.action?.onPress();
                      dismissToast(toast.id);
                    },
                  },
                ]
              : undefined
          }
        />
      )}
    </View>
  );
}

/**
 * The layer's offset from the screen bottom: in the room under a raised bar once the measured layer fits there, and
 * undefined until it is measured; otherwise above the bar, which already pads for the home indicator.
 */
export function toastLayerBottom(resting: number, lift: ToastLift | undefined, layerHeight: number | undefined) {
  if (!lift) return resting;
  const lifted = lift.height + Spacing.two;
  if (!lift.room) return lifted;
  if (layerHeight === undefined) return undefined;
  return resting + layerHeight + Spacing.two <= lift.room ? resting : lifted;
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    left: Spacing.content,
    right: Spacing.content,
    alignItems: "center",
    gap: 8,
  },
});
