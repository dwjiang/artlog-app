import { router } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useLandscape } from "@/lib/ui/use-landscape";

export const LABEL_BUTTON = "Scan the label";

export type SaveBarProps = {
  saveLabel?: string;
  canSave: boolean;
  saving: boolean;
  savedId?: string;
  error?: string;
  onSave: () => void;
  onViewSaved: () => void;
  visit?: ReactNode;
  /** What else the save does, shown above the save until it completes. */
  notice?: string;
};

export function SaveBar({
  saveLabel = "Save to collection",
  canSave,
  saving,
  savedId,
  error,
  onSave,
  onViewSaved,
  visit,
  notice,
}: SaveBarProps) {
  // In landscape the bar's rows sit side by side so the result above keeps room to scroll.
  const landscape = useLandscape();
  const viewArtwork = <GalleryButton label="View artwork" fullWidth onPress={onViewSaved} />;
  const scanNext = (
    <GalleryButton
      label="Scan next artwork"
      icon="arrow.right"
      iconPosition="trailing"
      variant="filled"
      fullWidth
      onPress={() => {
        router.dismissAll();
        router.navigate("/(tabs)/(scan)/scan");
      }}
    />
  );
  return (
    <View>
      {savedId ? (
        landscape ? (
          <View style={styles.beside}>
            <View style={styles.half}>{viewArtwork}</View>
            <View style={styles.half}>{scanNext}</View>
          </View>
        ) : (
          <ActionStack textActions={viewArtwork}>{scanNext}</ActionStack>
        )
      ) : (
        <>
          {notice && (
            <ThemedText variant="metadata" themeColor="textSecondary" style={styles.notice}>
              {notice}
            </ThemedText>
          )}
          <View style={landscape && styles.beside}>
            {visit && <View style={landscape && styles.half}>{visit}</View>}
            <View style={[styles.actions, landscape && styles.half]}>
              <GalleryButton
                label={saveLabel}
                icon="bookmark"
                variant="filled"
                fullWidth
                busy={saving}
                busyLabel="Saving…"
                disabled={!canSave || saving}
                onPress={onSave}
              />
              {!canSave && (
                <ThemedText type="small" themeColor="textSecondary">
                  Shorten these details to save this work.
                </ThemedText>
              )}
              {error && (
                <ThemedText type="small" themeColor="error" accessibilityRole="alert">
                  {error}
                </ThemedText>
              )}
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { gap: Spacing.two },
  beside: { flexDirection: "row", alignItems: "center", gap: Spacing.content },
  half: { flex: 1 },
  notice: { paddingTop: Spacing.compact },
});
