import { Host, ProgressView } from "@expo/ui/swift-ui";
import { tint } from "@expo/ui/swift-ui/modifiers";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { AccessibilityInfo, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { GalleryIconButton } from "@/components/collection/gallery-icon-button";
import { LoadingRing } from "@/components/loading-ring";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { CompactBarMaxTextScale, Gallery, Radius, Spacing, Typography } from "@/constants/theme";

type Commit = { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; busyLabel?: string };

/** Closes a sheet with nothing to save from its top trailing corner. */
export function CloseButton({
  onPress,
  label = "Close",
  disabled = false,
}: {
  onPress: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return <GalleryIconButton label={label} icon="xmark" disabled={disabled} onPress={onPress} />;
}

export function CancelToolbar({ onPress, disabled = false }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button tintColor={Gallery.ink} disabled={disabled} onPress={onPress}>
        Cancel
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}

/**
 * The edit's commit as a prominent bar button; while `busy`, a spinner holds its slot under `busyLabel`. With
 * `onDone`, Done leads it to finish editing a field, wherever the field has scrolled.
 */
export function CommitToolbar({
  label,
  busyLabel = "Saving…",
  busy = false,
  disabled = false,
  onPress,
  onDone,
}: Commit & { onDone?: () => void }) {
  return (
    <Stack.Toolbar placement="right">
      {onDone && (
        <Stack.Toolbar.Button tintColor={Gallery.accent} onPress={onDone}>
          Done
        </Stack.Toolbar.Button>
      )}
      {busy ? (
        // The capsule paints the prominent fill itself; the shared glass would ring it.
        <Stack.Toolbar.View hidesSharedBackground>
          <BusyCapsule label={label} busyLabel={busyLabel} />
        </Stack.Toolbar.View>
      ) : (
        <Stack.Toolbar.Button variant="prominent" tintColor={Gallery.accent} disabled={disabled} onPress={onPress}>
          {label}
        </Stack.Toolbar.Button>
      )}
    </Stack.Toolbar>
  );
}

/**
 * The bar of an editing sheet that has no navigation bar: Cancel, the title, then the commit, as `CancelToolbar` and
 * `CommitToolbar` lay out a native one. Like a navigation bar it keeps one row at every text size: its text stops
 * growing at accessibility sizes, and a long title truncates in the middle.
 */
export function EditBar({
  title,
  onCancel,
  cancelDisabled = false,
  commit,
  style,
}: {
  title: string;
  onCancel: () => void;
  cancelDisabled?: boolean;
  commit: Commit;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.editBar, style]}>
      <BarButton label="Cancel" disabled={cancelDisabled} onPress={onCancel} />
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        ellipsizeMode="middle"
        maxFontSizeMultiplier={CompactBarMaxTextScale}
        style={styles.title}
      >
        {title}
      </Text>
      <BarButton prominent {...commit} />
    </View>
  );
}

function BarButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  busyLabel = "Saving…",
  prominent = false,
}: Commit & { prominent?: boolean }) {
  useEffect(() => {
    if (busy) AccessibilityInfo.announceForAccessibility(`${label}. In progress.`);
  }, [busy, label]);
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={busy ? { text: busyLabel } : undefined}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={[styles.barButton, prominent && styles.prominent, disabled && !busy && styles.disabled]}
    >
      {/* While busy, the hidden label holds the button's size under the ring. */}
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={CompactBarMaxTextScale}
        style={[prominent ? styles.commitLabel : styles.cancelLabel, busy && styles.hidden]}
      >
        {label}
      </Text>
      {busy && (
        <View style={styles.spinner}>
          <LoadingRing color={prominent ? Gallery.surface : Gallery.ink} accessible={false} />
        </View>
      )}
    </MotionPressable>
  );
}

// Bar buttons have no loading state, so this holds the button's slot at its size.
function BusyCapsule({ label, busyLabel }: { label: string; busyLabel: string }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={busyLabel}
      accessibilityState={{ busy: true }}
      style={styles.capsule}
    >
      {/* The hidden label sizes the capsule like the button it replaces; bar labels ignore Dynamic Type. */}
      <Text allowFontScaling={false} style={styles.label}>
        {label}
      </Text>
      <View style={styles.spinner}>
        <Host matchContents colorScheme="light">
          <ProgressView modifiers={[tint(Gallery.surface)]} />
        </Host>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editBar: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  title: { ...Typography.button, flex: 1, textAlign: "center", color: Gallery.ink },
  barButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  prominent: { paddingHorizontal: Spacing.compact, borderRadius: Radius.button, backgroundColor: Gallery.accent },
  disabled: { opacity: 0.5 },
  cancelLabel: { fontSize: 17, lineHeight: 22, color: Gallery.ink },
  commitLabel: { ...Typography.button, color: Gallery.surface },
  hidden: { opacity: 0 },
  capsule: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    justifyContent: "center",
    backgroundColor: Gallery.accent,
  },
  label: { fontSize: 17, lineHeight: 22, fontWeight: "600", opacity: 0 },
  spinner: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
});
