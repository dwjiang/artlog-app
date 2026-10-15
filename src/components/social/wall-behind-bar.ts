import { useHeaderHeight } from "expo-router/react-navigation";
import { useState } from "react";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useScrolledUnderBar } from "@/hooks/use-scrolled-under-bar";

/**
 * Follows a wall scrolling up behind the transparent bar: `title` once the wall's top edge reaches the middle of the bar,
 * and `status` once it reaches the middle of the status bar. Feed the wall's layout, in scroll-content coordinates, and
 * the scroll events.
 */
export function useWallBehindBar() {
  const headerHeight = useHeaderHeight();
  const { top } = useSafeAreaInsets();
  const [behind, setBehind] = useState({ title: false, status: false });
  const title = useScrolledUnderBar((under) => setBehind((current) => ({ ...current, title: under })));
  const status = useScrolledUnderBar((under) => setBehind((current) => ({ ...current, status: under })));

  return {
    ...behind,
    // Each tracker fires as an edge passes the bar's bottom, so the wall's edge is shifted by its line's distance from it.
    onWallLayout: ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
      title.recordEdge(layout.y + (headerHeight - top) / 2);
      status.recordEdge(layout.y + headerHeight - top / 2);
    },
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      title.onScroll(event);
      status.onScroll(event);
    },
  };
}
