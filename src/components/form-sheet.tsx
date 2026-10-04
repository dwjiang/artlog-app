import { router, Stack } from "expo-router";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { ThemedText as Text } from "@/components/themed-text";
import { ToastLayer } from "@/components/toast";
import { Gallery, Typography } from "@/constants/theme";
import { useFittedFormSheetStyle } from "@/hooks/use-fitted-sheet";

/** The page of a `fitToContents` form sheet route: a display title and Close over its scrolling form. */
export function FormSheet({
  title,
  busy,
  grouped = false,
  children,
}: {
  title: string;
  busy: boolean;
  /** Paints the sheet gray for content in grouped `ListRow` cards. */
  grouped?: boolean;
  children: ReactNode;
}) {
  const { fontScale } = useWindowDimensions();
  const sheetStyle = useFittedFormSheetStyle();
  const { bottom } = useSafeAreaInsets();
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !busy }} />
      <ScrollView
        style={[styles.root, grouped && styles.grouped, sheetStyle]}
        bounces={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, fontScale > 1.3 && Typography.display]}>
            {title}
          </Text>
          <GalleryIconButton label="Close" icon="xmark" disabled={busy} onPress={() => router.back()} />
        </View>
        {children}
      </ScrollView>
      {/* The sheet covers the root toast layer, and it already clears the home indicator, so the layer's safe-area
          padding is cancelled. A failure toast covers the send button; its Retry sends the same input. */}
      <ToastLayer offset={-bottom} />
    </>
  );
}

export const formSheetStyles = StyleSheet.create({
  input: {
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Gallery.controlBorder,
    color: Gallery.ink,
    backgroundColor: Gallery.surface,
    fontSize: 17,
    textAlignVertical: "top",
  },
});

const styles = StyleSheet.create({
  root: { backgroundColor: Gallery.paper },
  grouped: { backgroundColor: Gallery.groupedBackground },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20, gap: 12 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 4 },
  title: { ...Typography.display, fontSize: 36, lineHeight: 42, flex: 1, color: Gallery.ink },
});
