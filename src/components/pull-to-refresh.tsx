import { useState, type Component } from "react";
import { RefreshControl, type LayoutChangeEvent } from "react-native";
import { useAnimatedStyle, useScrollOffset, type AnimatedRef } from "react-native-reanimated";

import { Gallery } from "@/constants/theme";

/**
 * Pull-to-refresh whose spinner turns under a screen's in-list header instead of above it. Views given `headerStyle`
 * hold still while the content below is pulled, and the view given `onHeaderLayout` (the lowest one) sets where the
 * native spinner is drawn. `restInset` is the scroll view's automatic top inset: the safe area, or a transparent
 * navigation bar's height. An opaque navigation bar lays the screen out below itself, leaving no inset.
 * A promise returned by `onRefresh` keeps the spinner turning until it settles. Keep `enabled` false while the scroll
 * view is unmounted: Reanimated warns when it observes a ref that is not attached.
 */
export function usePullToRefresh<T extends Component>(
  scrollRef: AnimatedRef<T>,
  {
    enabled = true,
    refreshing = false,
    onRefresh,
    restInset = 0,
    tintColor = Gallery.muted,
  }: {
    enabled?: boolean;
    refreshing?: boolean;
    onRefresh: () => void | Promise<unknown>;
    restInset?: number;
    tintColor?: string;
  },
) {
  const [pending, setPending] = useState(false);
  const [headerBottom, setHeaderBottom] = useState(0);
  const offset = useScrollOffset(enabled ? scrollRef : null);
  const headerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: enabled ? Math.min(0, offset.value + restInset) : 0 }],
  }));
  const spinning = enabled && (refreshing || pending);
  return {
    refreshing: spinning,
    headerStyle,
    onHeaderLayout: ({ nativeEvent: { layout } }: LayoutChangeEvent) => setHeaderBottom(layout.y + layout.height),
    refreshControl: enabled ? (
      <RefreshControl
        refreshing={spinning}
        tintColor={tintColor}
        progressViewOffset={headerBottom}
        onRefresh={() => {
          const result = onRefresh();
          if (!result) return;
          setPending(true);
          void result.finally(() => setPending(false));
        }}
      />
    ) : undefined,
  };
}
