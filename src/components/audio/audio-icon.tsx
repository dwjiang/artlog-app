import { Image, type ImageSource } from "expo-image";
import { type ColorValue, type StyleProp, type ViewStyle } from "react-native";

import { MotionPressable } from "@/components/motion-pressable";
import { Gallery } from "@/constants/theme";

export function AudioIcon({
  name,
  size = 22,
  color = Gallery.ink,
}: {
  name: string;
  size?: number;
  color?: ColorValue;
}) {
  return <Image source={`sf:${name}` as ImageSource} style={{ width: size, height: size, color }} accessible={false} />;
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
  color?: ColorValue;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        {
          minWidth: 44,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.35 : 1,
        },
        style,
      ]}
    >
      <AudioIcon name={name} size={size} color={color} />
    </MotionPressable>
  );
}
