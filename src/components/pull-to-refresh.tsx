import { useState } from "react";
import { RefreshControl } from "react-native";

import { Gallery } from "@/constants/theme";

/**
 * A plain pull-to-refresh control: the whole page moves and the spinner sits above it. A promise returned by
 * `onRefresh` keeps the spinner turning until it settles; otherwise `refreshing` drives it. While disabled it offers
 * no pull and reports no refresh. A negative `progressViewOffset` raises the spinner, for content that starts above the
 * scroll view's top inset.
 */
export function usePullToRefresh({
  enabled = true,
  refreshing = false,
  progressViewOffset,
  onRefresh,
}: {
  enabled?: boolean;
  refreshing?: boolean;
  progressViewOffset?: number;
  onRefresh: () => void | Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);
  const spinning = enabled && (refreshing || pending);
  return {
    refreshing: spinning,
    refreshControl: enabled ? (
      <RefreshControl
        refreshing={spinning}
        tintColor={Gallery.muted}
        progressViewOffset={progressViewOffset}
        // UIKit puts the spinner behind the content, where paint above the content's top edge (the collection wall's
        // paper overscroll) would hide it.
        style={{ zIndex: 1 }}
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
