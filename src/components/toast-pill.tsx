import { LoadingRing } from "./loading-ring";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gallery, Radius, Spacing, Typography } from "@/constants/theme";
import { ThemedText } from "./themed-text";

export function ToastPill({
  message,
  actions,
  busy = false,
}: {
  message: string;
  actions?: { label: string; onPress: () => void }[];
  busy?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  return (
    <View
      style={[
        styles.pill,
        fontScale >= 1.5 && styles.stacked,
        busy && styles.busy,
      ]}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy }}
    >
      {busy ? (
        <LoadingRing accessibilityLabel={message} color={Gallery.surface} />
      ) : (
        <ThemedText
          variant="secondary"
          accessibilityRole="alert"
          style={styles.message}
        >
          {message}
        </ThemedText>
      )}
      {actions?.map((action) => (
        <Pressable
          key={action.label}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: busy, busy }}
          disabled={busy}
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.action,
            { opacity: busy ? 0.6 : pressed ? 0.75 : 1 },
          ]}
        >
          <ThemedText style={styles.actionLabel}>{action.label}</ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.compact,
    minWidth: 180,
    maxWidth: "100%",
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.input,
    borderCurve: "continuous",
    backgroundColor: Gallery.ink,
  },
  stacked: { flexDirection: "column", alignItems: "stretch" },
  busy: { justifyContent: "center" },
  message: { flexShrink: 1, color: Gallery.surface },
  action: { minWidth: 44, minHeight: 44, justifyContent: "center" },
  actionLabel: {
    ...Typography.secondary,
    fontWeight: "600",
    color: Gallery.surface,
    textDecorationLine: "underline",
  },
});
