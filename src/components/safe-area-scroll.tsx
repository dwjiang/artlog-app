import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  FlatList as NativeFlatList,
  Keyboard,
  ScrollView as NativeScrollView,
  SectionList as NativeSectionList,
  type FlatListProps,
  type ScrollViewInstance,
  type ScrollViewProps,
  type SectionListProps,
} from "react-native";

import { useHorizontalSafeAreaPadding } from "@/lib/ui/safe-area";

function adjustsVertically({ horizontal, contentInsetAdjustmentBehavior }: ScrollViewProps) {
  return !horizontal && contentInsetAdjustmentBehavior != null && contentInsetAdjustmentBehavior !== "never";
}

/**
 * UIKit's automatic scroll insets cover only the scrolling axis. Across it, a vertical list that adjusts for the safe
 * area pads its content container instead, so rows clear a side bar while the background stays edge to edge.
 */
function useContentContainerStyle(props: ScrollViewProps) {
  const padding = useHorizontalSafeAreaPadding(props.contentContainerStyle);
  return adjustsVertically(props) ? [props.contentContainerStyle, padding] : props.contentContainerStyle;
}

/**
 * Each keyboard inset change makes React Native re-apply the offset clamped to its own insets, which leave out the
 * automatic ones, so content resting below a header (a negative offset) would snap up behind it. Below zero that clamp
 * can only move the offset to zero, so it is skipped there. Re-applying the offset also stops a bounce, so content let
 * go past the top while the keyboard moves is settled back to the top edge with `settle` afterwards.
 *
 * For scroll views with automatic and keyboard insets that cannot be a `SafeAreaScrollView`; spread the result last.
 */
export function useKeyboardOffsetProps(
  { onLayout, onScroll, onScrollBeginDrag, onScrollEndDrag, ...props }: ScrollViewProps,
  settle: (y: number) => void,
): ScrollViewProps {
  const enabled = adjustsVertically(props) && !!props.automaticallyAdjustKeyboardInsets;
  const [belowTop, setBelowTop] = useState(true);
  const offset = useRef(0);
  const bounceTarget = useRef<number>(undefined);
  useEffect(() => {
    if (!enabled) return;
    const subscription = Keyboard.addListener("keyboardDidChangeFrame", () => {
      if (bounceTarget.current !== undefined && offset.current < bounceTarget.current) settle(bounceTarget.current);
    });
    return () => subscription.remove();
  }, [enabled, settle]);
  if (!enabled) return {};
  return {
    scrollToOverflowEnabled: props.scrollToOverflowEnabled ?? belowTop,
    onLayout: (event) => {
      bounceTarget.current = undefined;
      onLayout?.(event);
    },
    onScroll: (event) => {
      offset.current = event.nativeEvent.contentOffset.y;
      if (bounceTarget.current !== undefined && offset.current >= bounceTarget.current) {
        bounceTarget.current = undefined;
      }
      setBelowTop(offset.current < 0);
      onScroll?.(event);
    },
    onScrollBeginDrag: (event) => {
      bounceTarget.current = undefined;
      onScrollBeginDrag?.(event);
    },
    onScrollEndDrag: (event) => {
      const { contentOffset, targetContentOffset, velocity } = event.nativeEvent;
      offset.current = contentOffset.y;
      // A negative destination can be ordinary upward momentum; require a stationary or downward release.
      bounceTarget.current =
        velocity
        && velocity.y <= 0
        && targetContentOffset
        && targetContentOffset.y <= 0
        && contentOffset.y < targetContentOffset.y
          ? targetContentOffset.y
          : undefined;
      onScrollEndDrag?.(event);
    },
  };
}

/** The wrapper's own ref to its view, which it also hands to the caller's `ref`. */
function useInnerRef<T>(ref: Ref<T> | undefined) {
  const inner = useRef<T>(null);
  useImperativeHandle(ref, () => inner.current as T);
  return inner;
}

export function SafeAreaScrollView({ ref, ...props }: ScrollViewProps & { ref?: Ref<ScrollViewInstance> }) {
  const scroll = useInnerRef(ref);
  const contentContainerStyle = useContentContainerStyle(props);
  const keyboardOffset = useKeyboardOffsetProps(props, (y) => scroll.current?.scrollTo({ y, animated: true }));
  return <NativeScrollView ref={scroll} {...props} {...keyboardOffset} contentContainerStyle={contentContainerStyle} />;
}

export function SafeAreaFlatList<T>({ ref, ...props }: FlatListProps<T> & { ref?: Ref<NativeFlatList<T>> }) {
  const list = useInnerRef(ref);
  const contentContainerStyle = useContentContainerStyle(props);
  const keyboardOffset = useKeyboardOffsetProps(props, (offset) =>
    list.current?.scrollToOffset({ offset, animated: true }),
  );
  return <NativeFlatList ref={list} {...props} {...keyboardOffset} contentContainerStyle={contentContainerStyle} />;
}

export function SafeAreaSectionList<T, S>({
  ref,
  ...props
}: SectionListProps<T, S> & { ref?: Ref<NativeSectionList<T, S>> }) {
  const contentContainerStyle = useContentContainerStyle(props);
  return <NativeSectionList ref={ref} {...props} contentContainerStyle={contentContainerStyle} />;
}
