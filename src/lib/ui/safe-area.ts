import { StyleSheet, useWindowDimensions, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";

/**
 * A style's own left and right padding plus the horizontal safe area, so content clears a side bar (the iPhone Duo's
 * rail, the camera housing in landscape) while the view's background still reaches the screen edge.
 */
export function horizontalSafeAreaPadding(style: StyleProp<ViewStyle>, insets: Pick<EdgeInsets, "left" | "right">) {
  const { padding, paddingHorizontal, paddingLeft, paddingRight } = StyleSheet.flatten(style) ?? {};
  return {
    paddingLeft: points(paddingLeft ?? paddingHorizontal ?? padding) + insets.left,
    paddingRight: points(paddingRight ?? paddingHorizontal ?? padding) + insets.right,
  };
}

const points = (value: DimensionValue | undefined) => (typeof value === "number" ? value : 0);

export function useHorizontalSafeAreaPadding(style?: StyleProp<ViewStyle>) {
  return horizontalSafeAreaPadding(style, useSafeAreaInsets());
}

/**
 * Lets a sideways row inside a scroll view padded by the horizontal safe area run under the side bars to the screen
 * edges, as photos and backgrounds do, while its first and last items rest inside the safe area. `contentStyle` is the
 * row's own content container style.
 */
export function safeAreaBleed(contentStyle: StyleProp<ViewStyle>, insets: Pick<EdgeInsets, "left" | "right">) {
  return {
    style: { marginLeft: -insets.left, marginRight: -insets.right },
    contentContainerStyle: [contentStyle, horizontalSafeAreaPadding(contentStyle, insets)],
  };
}

export function useSafeAreaBleed(contentStyle?: StyleProp<ViewStyle>) {
  return safeAreaBleed(contentStyle, useSafeAreaInsets());
}

/** The window's width beside its horizontal safe area: the room a padded screen's content has. */
export function useSafeAreaWidth() {
  const { width } = useWindowDimensions();
  const { left, right } = useSafeAreaInsets();
  return width - left - right;
}
