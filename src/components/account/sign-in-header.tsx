import { StyleSheet, View } from "react-native";

import { AppIcon } from "@/components/app-icon";
import { ThemedText as Text } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

export function SignInHeader({ title }: { title: string }) {
  return (
    <View style={styles.root}>
      <AppIcon size={64} />
      <Text variant="display" accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", gap: Spacing.three },
  title: { textAlign: "center" },
});
