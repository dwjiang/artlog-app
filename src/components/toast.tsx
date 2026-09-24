import { useSegments } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomTabInset, Spacing } from "@/constants/theme";
import { dismissToast, useToast } from "@/lib/ui/toast";
import { ToastPill } from "./toast-pill";

/** Floats the current toast (and any extra pills passed as children) above the bottom edge; screens report outcomes through
 *  `showToast` instead of inline banners. Natively presented sheets cover the root layer, so a flow inside one mounts its own.
 *  Without an explicit offset the layer clears the tab bar only while a tab is focused; root-stack screens cover the tabs. */
export function ToastLayer({
  children,
  offset,
}: {
  children?: ReactNode;
  offset?: number;
}) {
  const toast = useToast();
  const { bottom } = useSafeAreaInsets();
  const [root] = useSegments();
  const inset = offset ?? (root === "(tabs)" ? BottomTabInset : 0);
  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, { bottom: bottom + inset + Spacing.content }]}
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

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    left: Spacing.content,
    right: Spacing.content,
    alignItems: "center",
    gap: 8,
  },
});
