import { MenuView, type MenuAction } from "@expo/ui/community/menu";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Gallery } from "@/constants/theme";

export function DownloadIcon({
  name,
  color = Gallery.ink,
  size = 20,
}: {
  name: string;
  color?: string;
  size?: number;
}) {
  return <Image source={`sf:${name}`} tintColor={color} style={{ width: size, height: size }} accessible={false} />;
}
export function IconAction({
  label,
  icon,
  onPress,
  color = Gallery.ink,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.icon, { opacity: pressed ? 0.5 : 1 }]}
    >
      <DownloadIcon name={icon} color={color} />
    </Pressable>
  );
}
export function DownloadMenu({
  label,
  icon,
  actions,
  onAction,
  color = Gallery.ink,
}: {
  label: string;
  icon: string;
  actions: MenuAction[];
  onAction: (action: string) => void;
  color?: string;
}) {
  return (
    <MenuView
      actions={actions}
      onPressAction={(event) => onAction(event.nativeEvent.event)}
      colorScheme="light"
      style={styles.icon}
    >
      <View accessible accessibilityRole="button" accessibilityLabel={label} style={styles.icon}>
        <DownloadIcon name={icon} color={color} />
      </View>
    </MenuView>
  );
}
export function DownloadButton({
  label,
  icon,
  onPress,
  secondary = false,
}: {
  label: string;
  icon?: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary ? styles.secondary : styles.primary,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {icon && <DownloadIcon name={icon} size={19} color={secondary ? Gallery.accent : Gallery.surface} />}
      <Text
        style={{
          fontSize: 14,
          lineHeight: 20,
          fontWeight: secondary ? "400" : "600",
          color: secondary ? Gallery.accent : Gallery.surface,
          flexShrink: 1,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function DownloadProgress({ name, progress }: { name: string; progress: number }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${name} download`}
      accessibilityValue={{ min: 0, max: 100, now: progress }}
      style={{
        height: 6,
        backgroundColor: Gallery.softBorder,
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${progress}%`,
          height: "100%",
          backgroundColor: Gallery.accent,
          borderRadius: 4,
        }}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  icon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    minHeight: 48,
    minWidth: 44,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  primary: { flex: 1, backgroundColor: Gallery.accent },
  secondary: { backgroundColor: "transparent" },
});
