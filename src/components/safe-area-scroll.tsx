import { type Ref } from "react";
import {
  FlatList as NativeFlatList,
  ScrollView as NativeScrollView,
  SectionList as NativeSectionList,
  type FlatListProps,
  type ScrollViewInstance,
  type ScrollViewProps,
  type SectionListProps,
} from "react-native";

import { useHorizontalSafeAreaPadding } from "@/lib/ui/safe-area";

/**
 * UIKit's automatic scroll insets cover only the scrolling axis. Across it, a vertical list that adjusts for the safe
 * area pads its content container instead, so rows clear a side bar while the background stays edge to edge.
 */
function useContentContainerStyle({
  horizontal,
  contentInsetAdjustmentBehavior,
  contentContainerStyle,
}: Pick<ScrollViewProps, "horizontal" | "contentInsetAdjustmentBehavior" | "contentContainerStyle">) {
  const padding = useHorizontalSafeAreaPadding(contentContainerStyle);
  const adjusts = !horizontal && contentInsetAdjustmentBehavior != null && contentInsetAdjustmentBehavior !== "never";
  return adjusts ? [contentContainerStyle, padding] : contentContainerStyle;
}

export function SafeAreaScrollView({ ref, ...props }: ScrollViewProps & { ref?: Ref<ScrollViewInstance> }) {
  const contentContainerStyle = useContentContainerStyle(props);
  return <NativeScrollView ref={ref} {...props} contentContainerStyle={contentContainerStyle} />;
}

export function SafeAreaFlatList<T>({ ref, ...props }: FlatListProps<T> & { ref?: Ref<NativeFlatList<T>> }) {
  const contentContainerStyle = useContentContainerStyle(props);
  return <NativeFlatList ref={ref} {...props} contentContainerStyle={contentContainerStyle} />;
}

export function SafeAreaSectionList<T, S>({
  ref,
  ...props
}: SectionListProps<T, S> & { ref?: Ref<NativeSectionList<T, S>> }) {
  const contentContainerStyle = useContentContainerStyle(props);
  return <NativeSectionList ref={ref} {...props} contentContainerStyle={contentContainerStyle} />;
}
