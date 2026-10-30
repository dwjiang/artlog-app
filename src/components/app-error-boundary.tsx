import type { ErrorBoundaryProps } from "expo-router";
import { useEffect } from "react";
import { StyleSheet } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { SafeAreaScrollView } from "@/components/safe-area-scroll";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { addBreadcrumb, reportError } from "@/lib/observability";

export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    // The screen is gone whatever the cause, so even an offline or "not found" error that reached it is a bug.
    reportError(error, "app.render", { alwaysReport: "all" });
  }, [error]);
  return (
    <SafeAreaScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <ThemedText type="subtitle" accessibilityRole="alert">
        Artlog could not open this screen
      </ThemedText>
      <ThemedText>Try opening it again. Your saved collection is still on this phone.</ThemedText>
      <GalleryButton
        label="Retry"
        onPress={() => {
          addBreadcrumb("app.render.retry");
          void retry().catch((cause: unknown) => reportError(cause, "app.render.retry"));
        }}
      />
    </SafeAreaScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Gallery.paper },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: Spacing.four,
    gap: Spacing.two,
  },
});
