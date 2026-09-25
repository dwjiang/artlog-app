import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";

// Jest has no native header, so header toolbar items render inline where tests can press them.
function Toolbar({ children }: { children: ReactNode }) {
  return children;
}
Toolbar.View = Toolbar;
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

export const mockStack = { Toolbar, Screen: () => null };
