import { Host, ProgressView } from "@expo/ui/swift-ui";
import { tint } from "@expo/ui/swift-ui/modifiers";
import { Stack } from "expo-router";
import { StyleSheet, View } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery } from "@/constants/theme";

export function CancelToolbar({ onPress, disabled = false }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button tintColor={Gallery.ink} disabled={disabled} onPress={onPress}>
        Cancel
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}

/** The sheet's commit as a prominent bar button; while `busy`, a spinner holds its slot under `busyLabel`. */
export function CommitToolbar({
  label,
  busyLabel,
  busy,
  disabled = false,
  onPress,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Stack.Toolbar placement="right">
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
