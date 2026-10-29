import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { PermissionAsk } from "@/components/permissions/permission-ask";
import { Colors, Spacing } from "@/constants/theme";
import { useFittedFormSheetStyle } from "@/hooks/use-fitted-sheet";
import { requestNotificationPermission } from "@/lib/notifications/permission";
import { reportError } from "@/lib/observability";

export function NotificationsOfferSheet() {
  const { ask } = useLocalSearchParams<{ ask?: string }>();
  const sheetStyle = [styles.container, useFittedFormSheetStyle()];
  const [asking, setAsking] = useState(false);

  const requestPermission = async () => {
    if (asking) return;
    setAsking(true);
    try {
      await requestNotificationPermission();
    } catch (cause) {
      reportError(cause, "notifications.permission.request");
    }
    router.back();
  };

  return (
    <ScrollView style={sheetStyle} contentContainerStyle={styles.content} bounces={false}>
      <PermissionAsk kind={ask === "exhibitionReminders" ? ask : "notifications"} />
      <ActionStack>
        <GalleryButton
          label="Continue"
          variant="filled"
          fullWidth
          busy={asking}
          busyLabel="Asking…"
          onPress={() => void requestPermission()}
        />
      </ActionStack>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: Colors.light.background },
  // The welcome's permission pages: 28 above the mark, 24 above Continue.
  content: { padding: Spacing.content, paddingTop: 28, gap: Spacing.four },
});
