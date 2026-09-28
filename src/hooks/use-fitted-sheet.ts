import { useState } from "react";
import { useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type SheetPart = "header" | "content" | "footer";

/**
 * Measures a bottom sheet's pinned header and footer around its scroll content, so the sheet can rest at exactly
 * that height, up to the large detent's. Give the sheet's root view the same height: presented content lays out at
 * its own height rather than the sheet's, so only an explicit height makes an overflowing scroll view scroll.
 */
export function useFittedSheetHeight({ scrollAll = false } = {}) {
  const { height: windowHeight } = useWindowDimensions();
  const { top, bottom } = useSafeAreaInsets();
  const [parts, setParts] = useState<Record<SheetPart, number>>({ header: 0, content: 0, footer: 0 });
  const measure = (part: SheetPart, height: number) =>
    setParts((current) => (current[part] === height ? current : { ...current, [part]: height }));
  return {
    height: parts.content
      ? Math.min(parts.content + (scrollAll ? 0 : parts.header + parts.footer), windowHeight - top - bottom)
      : undefined,
    onHeaderLayout: (event: LayoutChangeEvent) => measure("header", event.nativeEvent.layout.height),
    onContentSizeChange: (_width: number, height: number) => measure("content", height),
    onFooterLayout: (event: LayoutChangeEvent) => measure("footer", event.nativeEvent.layout.height),
  };
}

/**
 * A `fitToContents` form sheet takes its height from its root scroll view, so an uncapped one grows past the tallest
 * detent and the sheet then stops scrolling short of its own end at large text sizes.
 */
export function useFittedFormSheetStyle() {
  const { height } = useWindowDimensions();
  const { top } = useSafeAreaInsets();
  return { flexGrow: 0, maxHeight: height - top };
}
