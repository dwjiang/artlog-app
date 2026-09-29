import { Button, Column, Host, Icon, Text as NativeText } from "@expo/ui";
import { accessibilityLabel, buttonStyle, contentShape, font, frame, shapes } from "@expo/ui/swift-ui/modifiers";
import type { ComponentProps } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { Gallery, Radius, Spacing } from "@/constants/theme";
import type { WallPiece } from "@/lib/wall/wall-layout";

function Tool({
  label,
  accessibilityName = label,
  icon,
  disabled,
  destructive = false,
  onPress,
}: {
  label: string;
  accessibilityName?: string;
  icon: ComponentProps<typeof Icon>["name"];
  disabled: boolean;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme="light"
      ignoreSafeArea="all"
      style={{ width: "100%", opacity: disabled ? 0.45 : 1 }}
    >
      <Button
        disabled={disabled}
        onPress={onPress}
        variant="text"
        modifiers={[buttonStyle("plain"), accessibilityLabel(accessibilityName), frame({ maxWidth: Infinity })]}
      >
        <Column
          spacing={6}
          alignment="center"
          modifiers={[frame({ maxWidth: Infinity, minHeight: 62 }), contentShape(shapes.rectangle())]}
        >
          <Icon name={icon} size={22} color={destructive ? Gallery.destructive : Gallery.accent} />
          <NativeText
            textStyle={{ color: destructive ? Gallery.destructive : Gallery.ink }}
            modifiers={[font({ textStyle: "caption", weight: "semibold" })]}
          >
            {label}
          </NativeText>
        </Column>
      </Button>
    </Host>
  );
}

export function WallEditorPalette({
  selected,
  disabled,
  onAdd,
  onWallpaper,
  onFrame,
  onRemove,
}: {
  selected?: WallPiece;
  disabled: boolean;
  onAdd: () => void;
  onWallpaper: () => void;
  onFrame: () => void;
  onRemove: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <View style={[styles.palette, { width: Math.min(132, 72 * fontScale) }]}>
      {selected ? (
        <>
          <Tool label="Frame" icon="square" disabled={disabled} onPress={onFrame} />
          <View style={styles.divider} />
          <Tool
            label="Remove"
            accessibilityName="Remove artwork from wall"
            icon="minus.circle"
            disabled={disabled}
            destructive
            onPress={onRemove}
          />
        </>
      ) : (
        <>
          <Tool label="Add" accessibilityName="Add art" icon="plus" disabled={disabled} onPress={onAdd} />
          <View style={styles.divider} />
          <Tool
            label="Style"
            accessibilityName="Wallpaper"
            icon="paintpalette"
            disabled={disabled}
            onPress={onWallpaper}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  palette: {
    backgroundColor: Gallery.paper,
    borderRadius: Radius.sheet,
    padding: Spacing.one,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.separator,
    boxShadow: "0 3px 16px rgba(0,0,0,0.10)",
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Gallery.separator, marginHorizontal: Spacing.compact },
});
