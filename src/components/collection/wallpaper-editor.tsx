import { Image } from "expo-image";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { isLightWall, type Wallpaper } from "@/lib/wall/wall-layout";

import { wallPatterns, wallpaperStyle } from "./wallpaper";

export function WallpaperEditor({ value, onChange }: { value: Wallpaper; onChange: (value: Wallpaper) => void }) {
  const { height, fontScale } = useWindowDimensions();
  const colorName = Gallery.colors.find((color) => color.value === value.color)?.name;
  const patternName = wallPatterns.find((pattern) => pattern.value === value.pattern)?.name;
  return (
    <View style={{ maxHeight: height * 0.48 }}>
      <View style={styles.header}>
        <Text variant="section" accessibilityRole="header">
          Wallpaper
        </Text>
      </View>
      <ScrollView alwaysBounceVertical={false} contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text variant="secondary" style={styles.label}>
            Color
          </Text>
          <Text variant="metadata" themeColor="textSecondary">
            {colorName}
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
          {Gallery.colors.map(({ name, value: color }) => {
            const selected = color === value.color;
            return (
              <Pressable
                key={color}
                accessibilityRole="button"
                accessibilityLabel={name}
                accessibilityState={{ selected }}
                onPress={() => onChange({ ...value, color })}
                style={styles.colorTarget}
              >
                <View style={[styles.color, { backgroundColor: color }, selected && styles.selectedColor]}>
                  {selected && (
                    <Image
                      source="sf:checkmark"
                      style={styles.check}
                      tintColor={isLightWall(color) ? Gallery.ink : Gallery.paper}
                    />
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.heading}>
          <Text variant="secondary" style={styles.label}>
            Design
          </Text>
          <Text variant="metadata" themeColor="textSecondary">
            {patternName}
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
          {wallPatterns.map(({ name, value: pattern }) => {
            const selected = pattern === value.pattern;
            return (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityLabel={name}
                accessibilityState={{ selected }}
                onPress={() => onChange({ ...value, pattern })}
                style={{ width: 82 * Math.min(fontScale, 1.5), gap: Spacing.two }}
              >
                <View style={[styles.tile, wallpaperStyle({ ...value, pattern }), selected && styles.selectedTile]}>
                  {selected && (
                    <View style={styles.tileCheck}>
                      <Image source="sf:checkmark" style={styles.check} tintColor={Gallery.accent} />
                    </View>
                  )}
                </View>
                <Text
                  variant="metadata"
                  style={{
                    textAlign: "center",
                    color: selected ? Gallery.accent : Gallery.muted,
                    fontWeight: selected ? "600" : "400",
                  }}
                >
                  {name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.content,
    paddingVertical: Spacing.three,
  },
  content: { paddingBottom: Spacing.three, gap: Spacing.two },
  heading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: Spacing.content,
  },
  label: { fontWeight: "600" },
  choices: { paddingHorizontal: Spacing.content, paddingVertical: Spacing.one, gap: Spacing.compact },
  colorTarget: { width: 44, height: 48, alignItems: "center", justifyContent: "center" },
  color: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.controlBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedColor: { outlineWidth: 2, outlineOffset: 3, outlineColor: Gallery.accent },
  check: { width: 13, height: 13 },
  tile: {
    height: 60,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Gallery.softBorder,
    overflow: "hidden",
  },
  selectedTile: { borderWidth: 2, borderColor: Gallery.accent },
  tileCheck: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    backgroundColor: Gallery.paper,
    alignItems: "center",
    justifyContent: "center",
  },
});
