import { StyleSheet, View } from "react-native";

import { AppIcon } from "@/components/app-icon";
import { ThemedText as Text } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

// Caps Dynamic Type so the longest title word ("conversation", about 6 em) stays on one line in the narrowest sheet,
// 334 points on an iPhone 16e. iOS grows its own Large Title about as far.
const TITLE_MAX_FONT_SCALE = 1.8;

export function SignInHeader({ title }: { title: string }) {
  return (
    <View style={styles.root}>
      <AppIcon size={64} />
      <Text
        variant="display"
        accessibilityRole="header"
        maxFontSizeMultiplier={TITLE_MAX_FONT_SCALE}
        style={styles.title}
      >
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", gap: Spacing.three },
  title: { textAlign: "center" },
});
