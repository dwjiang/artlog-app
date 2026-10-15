import { Button, Host, Icon } from "@expo/ui";
import { accessibilityLabel, accessibilityValue, contentShape, frame, shapes, tint } from "@expo/ui/swift-ui/modifiers";
import type { ComponentProps } from "react";

import { NativeLoadingRing } from "@/components/native-loading-ring";
import { Gallery } from "@/constants/theme";

export function GalleryIconButton({
  label,
  icon,
  onPress,
  disabled = false,
  busy = false,
  tone = "ink",
  size = 21,
  iconModifiers = [],
}: {
  label: string;
  icon: ComponentProps<typeof Icon>["name"];
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "accent" | "ink" | "muted" | "surface";
  size?: number;
  iconModifiers?: ComponentProps<typeof Icon>["modifiers"];
}) {
  const color = Gallery[tone];
  return (
    <Host colorScheme="light" style={{ width: 44, height: 44 }}>
      <Button
        variant="text"
        onPress={onPress}
        disabled={disabled || busy}
        modifiers={[
          accessibilityLabel(label),
          accessibilityValue(busy ? "In progress" : ""),
          frame({ minWidth: 44, minHeight: 44 }),
          tint(color),
        ]}
      >
        {busy ? (
          <NativeLoadingRing label={`${label} in progress`} color={color} />
        ) : (
          <Icon
            name={icon}
            size={size}
            color={color}
            modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.rectangle()), ...iconModifiers]}
          />
        )}
      </Button>
    </Host>
  );
}
