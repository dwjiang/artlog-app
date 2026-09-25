import { Image } from "expo-image";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { isLightWall, type Wallpaper } from "@/lib/wall/wall-layout";

import { WallSheet } from "./wall-sheet";
import { wallPatterns, wallpaperStyle } from "./wallpaper";

const gap = Spacing.compact;
const swatchSize = 34;
const targetSize = 44;

export function WallpaperSheet({
  value,
  onChange,
  onDismiss,
}: {
  value: Wallpaper;
  onChange: (value: Wallpaper) => void;
  onDismiss: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const columns = fontScale > 1.4 ? 3 : 4;
  const tileWidth = (width - Spacing.content * 2 - gap * (columns - 1)) / columns;
  const colorName = Gallery.colors.find((color) => color.value === value.color)?.name;
  return (
    <WallSheet title="Wallpaper" onDismiss={onDismiss}>
      <View style={styles.content}>
        <View style={styles.heading}>
          <Text style={styles.label}>Color</Text>
          {colorName && <Text style={styles.caption}>{colorName}</Text>}
        </View>
        <ScrollView
          horizontal
          alwaysBounceHorizontal={false}
          showsHorizontalScrollIndicator={false}
          style={styles.colors}
          contentContainerStyle={styles.colorRow}
        >
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
                      style={styles.colorCheck}
                      tintColor={isLightWall(color) ? Gallery.ink : Gallery.paper}
                    />
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.heading}>
          <Text style={styles.label}>Pattern</Text>
        </View>
        <View style={styles.patterns}>
          {wallPatterns.map(({ name, value: pattern }) => {
            const selected = pattern === value.pattern;
            return (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityLabel={name}
                accessibilityState={{ selected }}
                onPress={() => onChange({ ...value, pattern })}
                style={{ width: tileWidth, gap: Spacing.one }}
              >
                <View style={[styles.tile, wallpaperStyle({ ...value, pattern })]}>
                  {selected && (
                    <>
                      <View style={styles.selectedTile} />
                      <View style={styles.tileCheck}>
                        <Image source="sf:checkmark" style={styles.tileCheckMark} tintColor={Gallery.ink} />
                      </View>
                    </>
                  )}
                </View>
                <Text
                  numberOfLines={1}
                  style={[styles.tileName, selected && { color: Gallery.ink, fontWeight: "600" }]}
                >
                  {name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </WallSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.content, paddingTop: Spacing.three, paddingBottom: Spacing.five },
  heading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingBottom: Spacing.two,
  },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: Gallery.ink },
  caption: { fontSize: 13, lineHeight: 18, color: Gallery.muted },
  // The row bleeds into the gutters so 44-point targets fit while the outer circles stay aligned to them; screens too
  // narrow for every target scroll it.
  colors: { marginHorizontal: -Spacing.content, marginBottom: Spacing.four },
  colorRow: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingHorizontal: Spacing.content - (targetSize - swatchSize) / 2,
  },
  colorTarget: { width: targetSize, height: targetSize, alignItems: "center", justifyContent: "center" },
  color: {
    width: swatchSize,
    height: swatchSize,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.controlBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedColor: {
    borderWidth: 0,
    outlineWidth: 2,
    outlineOffset: 2,
    outlineColor: Gallery.ink,
  },
  colorCheck: { width: 14, height: 14 },
  patterns: { flexDirection: "row", flexWrap: "wrap", gap },
  tile: {
    aspectRatio: 1.25,
    borderRadius: Radius.button,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.controlBorder,
  },
  selectedTile: {
    ...StyleSheet.absoluteFill,
    borderRadius: Radius.button,
    borderWidth: 2,
    borderColor: Gallery.ink,
  },
  tileCheck: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 20,
    height: 20,
    borderRadius: Radius.full,
    backgroundColor: Gallery.highlight,
    alignItems: "center",
    justifyContent: "center",
  },
  tileCheckMark: { width: 10, height: 10 },
  tileName: { fontSize: 12, lineHeight: 16, textAlign: "center", color: Gallery.muted },
});
