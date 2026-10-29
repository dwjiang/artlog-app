import { router, Stack } from "expo-router";
import { createContext, use, useRef, type ComponentProps, type ReactNode } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type ScrollViewInstance,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { CloseButton, EditBar } from "@/components/sheet-controls";
import { ThemedText as Text } from "@/components/themed-text";
import { ToastLayer } from "@/components/toast";
import { Gallery, Typography } from "@/constants/theme";
import { useFittedFormSheetStyle } from "@/hooks/use-fitted-sheet";
import { useTypingReveal } from "@/hooks/use-keyboard-reveal";

const RevealEnd = createContext<() => void>(() => {});

/**
 * The page of a `fitToContents` form sheet route over its scrolling form: with a `commit`, Cancel, the title and the
 * commit in a bar; without one, a display title and Close.
 */
export function FormSheet({
  title,
  busy,
  grouped = false,
  commit,
  children,
}: {
  title: string;
  busy: boolean;
  /** Paints the sheet gray for content in grouped `ListRow` cards. */
  grouped?: boolean;
  commit?: ComponentProps<typeof EditBar>["commit"];
  children: ReactNode;
}) {
  const { fontScale } = useWindowDimensions();
  const sheetStyle = useFittedFormSheetStyle();
  const { bottom } = useSafeAreaInsets();
  const scrollRef = useRef<ScrollViewInstance>(null);
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !busy }} />
      <SafeAreaScrollView
        ref={scrollRef}
        style={[styles.root, grouped && styles.grouped, sheetStyle]}
        bounces={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        // Like a navigation bar, the edit bar stays put while the form scrolls under it, clear of the grabber.
        stickyHeaderIndices={commit ? [0] : undefined}
        contentContainerStyle={styles.content}
      >
        {commit ? (
          <EditBar
            title={title}
            cancelDisabled={busy}
            onCancel={() => router.back()}
            commit={{ ...commit, busy }}
            style={[styles.bar, grouped && styles.grouped]}
          />
        ) : (
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, fontScale > 1.3 && Typography.display]}>
              {title}
            </Text>
            <CloseButton disabled={busy} onPress={() => router.back()} />
          </View>
        )}
        <RevealEnd value={() => scrollRef.current?.scrollToEnd({ animated: true })}>{children}</RevealEnd>
      </SafeAreaScrollView>
      {/* The sheet covers the root toast layer, and it already clears the home indicator, so the layer's safe-area
          padding is cancelled. A failure toast's Retry sends the same input. */}
      <ToastLayer offset={-bottom} />
    </>
  );
}

/**
 * A form sheet's multiline field, the last part of its form. Typing at its end scrolls the sheet to its end, which
 * keeps the line being typed above the keyboard: the sheet's place on screen is unknown here, but React Native's
 * scroll to the end stops at the keyboard's inset.
 */
export function FormSheetTextArea({
  minHeight,
  onChange,
  onContentSizeChange,
  ...props
}: Omit<TextInputProps, "style" | "multiline"> & { minHeight: number }) {
  const revealEnd = use(RevealEnd);
  const { onFieldChange, onFieldContentSizeChange } = useTypingReveal((atEnd) => {
    if (atEnd) revealEnd();
  });
  return (
    <TextInput
      keyboardAppearance="light"
      selectionColor={Gallery.accent}
      placeholderTextColor={Gallery.muted}
      {...props}
      multiline
      onChange={(event) => {
        onFieldChange(event);
        onChange?.(event);
      }}
      onContentSizeChange={(event) => {
        onFieldContentSizeChange();
        onContentSizeChange?.(event);
      }}
      style={[styles.input, { minHeight }]}
    />
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: Gallery.paper },
  grouped: { backgroundColor: Gallery.groupedBackground },
  content: { paddingHorizontal: 20, paddingBottom: 20, gap: 12 },
  bar: { paddingTop: 24, backgroundColor: Gallery.paper },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingTop: 24, marginBottom: 4 },
  title: { ...Typography.display, fontSize: 36, lineHeight: 42, flex: 1, color: Gallery.ink },
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
