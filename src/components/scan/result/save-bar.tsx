import { router } from "expo-router";
import { GalleryButton } from "@/components/collection/gallery-button";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

export const LABEL_BUTTON = "Scan the label";

export type SaveBarProps = {
  saveLabel?: string;
  canSave: boolean;
  saving: boolean;
  savedId?: string;
  error?: string;
  onSave: () => void;
  onLabel?: () => void;
  labelFirst?: boolean;
  onViewSaved: () => void;
  visit?: ReactNode;
};

export function SaveBar({
  saveLabel = "Save to collection",
  canSave,
  saving,
  savedId,
  error,
  onSave,
  onLabel,
  labelFirst = false,
  onViewSaved,
  visit,
}: SaveBarProps) {
  return (
    <View style={styles.bar}>
      {savedId ? (
        <View style={{ gap: 12 }}>
          <ThemedText type="title">Saved to collection</ThemedText>
          <Pressable accessibilityRole="link" onPress={onViewSaved} style={styles.saved}>
            <ThemedText themeColor="accent">View artwork</ThemedText>
          </Pressable>
          <GalleryButton
            label="Scan next artwork"
            variant="filled"
            fullWidth
            onPress={() => {
              router.dismissAll();
              router.navigate("/(tabs)/(scan)/scan");
            }}
          />
        </View>
      ) : (
        <>
          {visit}
          {onLabel && labelFirst && (
            <GalleryButton
              label={LABEL_BUTTON}
              variant="filled"
              fullWidth
              disabled={saving}
              onPress={onLabel}
            />
          )}
          <GalleryButton
            label={saveLabel}
            variant={labelFirst ? "outlined" : "filled"}
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
          {onLabel && !labelFirst && (
            <GalleryButton label={LABEL_BUTTON} fullWidth disabled={saving} onPress={onLabel} />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: Spacing.two },
  saved: { minHeight: 44, justifyContent: "center", paddingVertical: Spacing.two },
});
