import { Image, type ImageSource } from "expo-image";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";

import { Gallery } from "@/constants/theme";

export function AudioIcon({ name, size = 22, color = Gallery.ink }: { name: string; size?: number; color?: string }) {
  return (
    <Image
      source={`sf:${name}` as ImageSource}
      tintColor={color}
      style={{ width: size, height: size }}
      accessible={false}
    />
  );
}
export function AudioIconButton({
  name,
  label,
  onPress,
  size = 22,
  color,
  disabled,
  style,
}: {
  name: string;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minWidth: 44,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
        },
        style,
      ]}
    >
      <AudioIcon name={name} size={size} color={color} />
    </Pressable>
  );
}
