import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { useFittedFormSheetStyle } from "@/hooks/use-fitted-sheet";
import { requestNotificationPermission } from "@/lib/notifications/permission";
import { reportError } from "@/lib/observability";

export function NotificationsOfferSheet() {
  const sheetStyle = [styles.container, useFittedFormSheetStyle()];
  const [asking, setAsking] = useState(false);

  async function allow() {
    if (asking) return;
    setAsking(true);
    try {
      await requestNotificationPermission();
    } catch (cause) {
      reportError(cause, "notifications.permission.request");
    }
    router.back();
  }

  return (
    <ScrollView style={sheetStyle} contentContainerStyle={styles.content} bounces={false}>
      <ThemedText type="subtitle" accessibilityRole="header">
        Hear back from friends.
      </ThemedText>
      <ThemedText themeColor="textSecondary">
        Tells you about friend requests, likes, and comments, and when a visit is still open. Choose which in Settings.
      </ThemedText>
      <ActionStack>
        <GalleryButton
          label="Allow notifications"
          variant="filled"
          fullWidth
          busy={asking}
          busyLabel="Asking…"
          onPress={() => void allow()}
        />
        <GalleryButton
          label="Not now"
          variant="filled"
          tone="neutral"
          fullWidth
          disabled={asking}
          onPress={() => router.back()}
        />
      </ActionStack>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: Colors.light.background },
  content: { padding: Spacing.content, paddingTop: Spacing.four, gap: Spacing.three },
});
