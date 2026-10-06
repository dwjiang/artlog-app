import { useHeaderHeight } from "expo-router/react-navigation";
import { useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

/**
 * Calls `onChange` when an edge of the scroll content passes under the navigation bar, and again when it comes back
 * out. Feed the edge in scroll-content coordinates through `recordEdge` and scroll events through `onScroll`. The
 * offset stays unknown until the first scroll event, so the edge starts out below the bar.
 */
export function useScrolledUnderBar(onChange: (under: boolean) => void) {
  const headerHeight = useHeaderHeight();
  const position = useRef({ offset: -Infinity, edge: Infinity, under: false });

  function update() {
    const { current } = position;
    const under = current.offset + headerHeight >= current.edge;
    if (under === current.under) return;
    current.under = under;
    onChange(under);
  }

  return {
    recordEdge: (edge: number) => {
      position.current.edge = edge;
      update();
    },
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      position.current.offset = event.nativeEvent.contentOffset.y;
      update();
    },
  };
}
