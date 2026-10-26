import { useSegments } from "expo-router";
import { useVerticalBarEdgeIOS } from "expo-status-bar";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomTabInset, Spacing } from "@/constants/theme";
import { dismissToast, useToast, useToastLift, type ToastLift } from "@/lib/ui/toast";

import { ToastPill } from "./toast-pill";

/** Floats the current toast (and any extra pills passed as children) above the bottom edge; screens report outcomes through
 *  `showToast` instead of inline banners. Natively presented sheets cover the root layer, so a flow inside one mounts its own.
 *  Without an explicit offset the layer clears the tab bar only while a tab is focused and the bar sits at the bottom:
 *  root-stack screens cover the tabs, and iPhone Duo can move the bar into a vertical bar beside the content. */
export function ToastLayer({ children, offset }: { children?: ReactNode; offset?: number }) {
  return offset === undefined ? (
    <RoutedToastLayer>{children}</RoutedToastLayer>
  ) : (
    <PositionedToastLayer offset={offset}>{children}</PositionedToastLayer>
  );
}

function RoutedToastLayer({ children }: { children?: ReactNode }) {
  const [root] = useSegments();
  const verticalBar = useVerticalBarEdgeIOS();
  const bottomTabBar = root === "(tabs)" && verticalBar === null;
  return (
    <PositionedToastLayer offset={bottomTabBar ? BottomTabInset : 0} lifted>
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
  const { bottom, left, right } = useSafeAreaInsets();
  const lift = useToastLift();
  const layer = useRef<ViewInstance>(null);
  const [measured, setMeasured] = useState<{ id?: number; height: number }>();
  useLayoutEffect(() => {
    let current = true;
    // Replacing an equally sized toast does not fire onLayout; persistent Undo pills must stay mounted.
    layer.current?.measure((_x, _y, _width, height) => {
      if (current) setMeasured({ id: toast?.id, height });
    });
    return () => {
      current = false;
    };
  }, [toast?.id]);
  const resting = bottom + offset + Spacing.content;
  const position = lifted
    ? toastLayerBottom(resting, lift, measured?.id === toast?.id ? measured?.height : undefined)
    : resting;
  return (
    <View
      ref={layer}
      collapsable={false}
      pointerEvents="box-none"
      onLayout={({ nativeEvent: { layout } }) => setMeasured({ id: toast?.id, height: layout.height })}
      style={[
        styles.layer,
        { left: left + Spacing.content, right: right + Spacing.content },
        position === undefined ? { bottom: resting, opacity: 0 } : { bottom: position },
      ]}
    >
      {children}
      {toast && (
        <ToastPill
          key={toast.id}
          message={toast.message}
          image={toast.image}
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
    alignItems: "center",
    gap: 8,
  },
});
