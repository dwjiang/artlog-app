import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

// Jest has no native header, so header toolbar items render inline where tests can press them.
function Toolbar({ children }: { children: ReactNode }) {
  return children;
}
Toolbar.View = Toolbar;
Toolbar.Spacer = function ToolbarSpacer() {
  return null;
};
Toolbar.Button = function ToolbarButton({
  children,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      <Text>{children}</Text>
    </Pressable>
  );
};
// A badge reads as its button's text.
Toolbar.Badge = function ToolbarBadge({ children }: { children: string }) {
  return children;
};

// Menus render their label and actions inline, as if always open.
Toolbar.Menu = function ToolbarMenu({
  children,
  hidden,
  accessibilityLabel,
}: {
  children: ReactNode;
  hidden?: boolean;
  accessibilityLabel?: string;
}) {
  return hidden ? null : <View accessibilityLabel={accessibilityLabel}>{children}</View>;
};
Toolbar.Label = function ToolbarLabel({ children }: { children: string }) {
  return <Text>{children}</Text>;
};
Toolbar.MenuAction = function ToolbarMenuAction({
  children,
  onPress,
  isOn,
}: {
  children: string;
  onPress: () => void;
  isOn?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!isOn }} onPress={onPress}>
      <Text>{children}</Text>
    </Pressable>
  );
};

export const mockStack = { Toolbar, Screen: () => null };
