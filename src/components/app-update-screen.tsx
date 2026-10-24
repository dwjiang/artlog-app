import { Image } from "expo-image";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppUpdateButton } from "@/components/app-update-button";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
import { useHorizontalSafeAreaPadding } from "@/lib/ui/safe-area";

export function AppUpdateScreen() {
  const insets = useSafeAreaInsets();
  const padding = useHorizontalSafeAreaPadding(styles.content);
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.4;

  return (
    <ScrollView
      style={styles.screen}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[
        styles.content,
        padding,
        { paddingTop: insets.top + Spacing.content, paddingBottom: Math.max(insets.bottom, Spacing.four) },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.brand, largeText && styles.brandStacked]}>
          <Image
            source={require("../../assets/images/icon.png")}
            style={styles.logo}
            contentFit="contain"
            accessible={false}
          />
          <ThemedText variant={largeText ? "display" : "wordmark"}>Artlog</ThemedText>
        </View>
      </View>
      <View style={styles.message}>
        <ThemedText variant={largeText ? "display" : "pageTitle"} accessibilityRole="header">
          Update the app to continue.
        </ThemedText>
        <ThemedText themeColor="textSecondary">
          This version is no longer supported.{"\n"}Get the latest version to keep using Artlog.
        </ThemedText>
      </View>
      <AppUpdateButton />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Gallery.paper },
  content: { flexGrow: 1, paddingHorizontal: Spacing.content },
  header: {
    paddingBottom: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gallery.separator,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: Spacing.three },
  brandStacked: { flexDirection: "column", alignItems: "flex-start" },
  logo: { width: 64, height: 64, borderRadius: Radius.card, borderCurve: "continuous" },
  message: { flexGrow: 1, justifyContent: "center", gap: Spacing.content, paddingVertical: Spacing.six },
});
