import { Image } from "expo-image";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassSurface } from "@/components/glass-surface";
import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";

const IMPORT_SIZE = 64;
export const SHUTTER_SIZE = 72;

export function CaptureControls({
  children,
  onImport,
  importDisabled,
  importLabel = "Import",
}: {
  children: ReactNode;
  onImport: () => void;
  importDisabled: boolean;
  importLabel?: string;
}) {
  const { fontScale } = useWindowDimensions();
  const { left, right } = useSafeAreaInsets();
  const stacked = fontScale > 1.4;
  // The overlay pads each side by its safe area; the row runs back out to even gutters so the shutter centers on the
  // camera preview even beside a one-sided bar (the iPhone Duo's rail). Photos keeps its place inside the safe area.
  return (
    <View style={[styles.controls, stacked && styles.stackedControls, { marginLeft: -left, marginRight: -right }]}>
      <View style={!stacked && styles.side}>
        <GlassSurface isInteractive style={[styles.importButton, !stacked && { marginLeft: left }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={importLabel}
            disabled={importDisabled}
            accessibilityState={{ disabled: importDisabled }}
            onPress={onImport}
            style={({ pressed }) => [styles.importContent, (pressed || importDisabled) && styles.dimmed]}
          >
            <Image source="sf:photo" style={styles.importIcon} tintColor={Colors.light.overlayText} />
            <ThemedText variant="metadata" themeColor="overlayText">
              Photos
            </ThemedText>
          </Pressable>
        </GlassSurface>
      </View>
      {children}
      {!stacked && <View style={styles.side} />}
    </View>
  );
}

export function ShutterButton({
  label,
  hint,
  disabled,
  busy,
  onPress,
  children,
}: {
  label: string;
  hint?: string;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
  children?: ReactNode;
}) {
  return (
    <View style={styles.shutterContainer}>
      {children}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        disabled={disabled || busy}
        accessibilityState={{ disabled: disabled || busy, busy }}
        onPress={onPress}
        style={({ pressed }) => [styles.shutter, (pressed || disabled || busy) && styles.dimmed]}
      >
        <View style={styles.shutterInner} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: "row", alignItems: "center" },
  stackedControls: { flexDirection: "column", gap: Spacing.three },
  side: { flex: 1, alignItems: "flex-start" },
  importButton: { borderRadius: 12, overflow: "hidden" },
  importContent: {
    minWidth: IMPORT_SIZE,
    minHeight: IMPORT_SIZE,
    padding: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
  },
  importIcon: { width: 24, height: 24 },
  shutterContainer: { width: SHUTTER_SIZE, height: SHUTTER_SIZE },
  shutter: {
    width: SHUTTER_SIZE,
    height: SHUTTER_SIZE,
    borderRadius: SHUTTER_SIZE / 2,
    borderWidth: 3,
    borderColor: Colors.light.overlayText,
    padding: 4,
  },
  shutterInner: { flex: 1, borderRadius: SHUTTER_SIZE / 2, backgroundColor: Colors.light.overlayText },
  dimmed: { opacity: 0.7 },
});
