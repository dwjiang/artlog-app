import { openBrowserAsync } from "expo-web-browser";
import { reportError } from "@/lib/observability";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

/** A tappable citation that opens the source's page in the in-app browser. */
export function SourceLink({
  label,
  url,
  style,
  children,
}: {
  label: string;
  url: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  async function openSource() {
    setFailed(false);
    try {
      await openBrowserAsync(url);
    } catch (error) {
      reportError(error, "result.open_source", { level: "warning" });
      setFailed(true);
    }
  }
  return (
    <View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        onPress={() => {
          void openSource();
        }}
        style={style}
      >
        {children}
      </Pressable>
      {failed && (
        <ThemedText type="small" themeColor="error" accessibilityRole="alert">
          Couldn’t open this source. Tap the source to try again.
        </ThemedText>
      )}
    </View>
  );
}

/** A citation shown as the source's label. */
export function SourceChip({ label, url }: { label: string; url: string }) {
  return (
    <SourceLink label={label} url={url} style={styles.chip}>
      <ThemedText type="small" themeColor="accent">
        {label}
      </ThemedText>
    </SourceLink>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: Spacing.two,
  },
});
