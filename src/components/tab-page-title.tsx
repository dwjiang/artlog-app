import { StyleSheet, useWindowDimensions, type LayoutChangeEvent } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

/**
 * A tab root's title, first in its scroll content under a `ScrollTitleHeader` bar. A native large title would not
 * work: re-tapping the tab scrolls only to the content's top edge, which never re-expands a collapsed large title.
 */
export function TabPageTitle({
  children,
  onLayout,
}: {
  children: string;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <Text
      variant={fontScale > 1.3 ? "display" : "pageTitle"}
      accessibilityRole="header"
      style={styles.title}
      onLayout={onLayout}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: { paddingHorizontal: Spacing.content, paddingTop: Spacing.two, paddingBottom: Spacing.three },
});
