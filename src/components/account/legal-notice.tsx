import { StyleSheet } from "react-native";

import { ThemedText as Text } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { openLegalPage } from "@/lib/legal-links";

/** App Review expects the terms and privacy policy on every screen that starts using the app or creates an account. */
export function LegalNotice() {
  return (
    <Text type="small" themeColor="textSecondary" style={styles.notice}>
      By continuing, you agree to our{" "}
      <Text accessibilityRole="link" style={styles.link} onPress={() => void openLegalPage("terms")}>
        Terms of Service
      </Text>{" "}
      and acknowledge our{" "}
      <Text accessibilityRole="link" style={styles.link} onPress={() => void openLegalPage("privacy")}>
        Privacy Policy
      </Text>
      .
    </Text>
  );
}

const styles = StyleSheet.create({
  notice: { textAlign: "center", paddingHorizontal: Spacing.three },
  link: { color: Gallery.accent, fontWeight: "500" },
});
