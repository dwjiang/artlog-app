import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";

import { Spacing } from "@/constants/theme";

/**
 * Stacks buttons with any text buttons flush beneath them. A text button's 44-point target already leaves about
 * 11 points above its label, so an added gap would separate it from the action it belongs to.
 */
export function ActionStack({
  children,
  textActions,
  style,
}: {
  children: ReactNode;
  textActions?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      <View style={styles.buttons}>{children}</View>
      {textActions}
    </View>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: Spacing.two },
});
