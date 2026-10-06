import { useNavigation } from "expo-router";
import { useEffect, useRef } from "react";
import type { LayoutChangeEvent, ScrollView, Text } from "react-native";

import { NavigationTheme, ScrollTitleHeader } from "@/constants/theme";
import { useScrolledUnderBar } from "@/hooks/use-scrolled-under-bar";

const SHOWN = { headerTitleStyle: NavigationTheme.headerTitleStyle };
const HIDDEN = { headerTitleStyle: ScrollTitleHeader.headerTitleStyle };

/**
 * Shows `title` in the bar once the in-content heading's bottom edge scrolls under the transparent bar, and hides it
 * while the heading shows; the route takes `ScrollTitleHeader`. Feed that edge in scroll-content coordinates through
 * `onHeadingLayout` (on a direct child of the scroll content) or `measureHeading` (a nested heading on `headingRef`
 * inside the scroll view on `scrollRef`, re-measured whenever it may move), and scroll events through `onScroll`. The
 * bar changes only when the title flips, so scrolling never re-renders the screen. Destructure the result: the React
 * Compiler skips a component that reads the refs off the returned object.
 */
export function useScrollTitle(title: string) {
  const navigation = useNavigation();
  const scrollRef = useRef<ScrollView>(null);
  const headingRef = useRef<Text>(null);
  const { recordEdge, onScroll } = useScrolledUnderBar((shown) => navigation.setOptions(shown ? SHOWN : HIDDEN));

  useEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  return {
    scrollRef,
    headingRef,
    onHeadingLayout: ({ nativeEvent: { layout } }: LayoutChangeEvent) => recordEdge(layout.y + layout.height),
    measureHeading: () => {
      const scrollView = scrollRef.current?.getNativeScrollRef();
      if (!headingRef.current || !scrollView) return;
      headingRef.current.measureLayout(scrollView, (_left, top, _width, height) => recordEdge(top + height));
    },
    onScroll,
  };
}
