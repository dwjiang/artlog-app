import { router } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
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
  onViewSaved,
  visit,
}: SaveBarProps) {
  return (
    <View>
      {savedId ? (
        <View style={{ gap: Spacing.one }}>
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
          <GalleryButton label="View artwork" fullWidth onPress={onViewSaved} />
        </View>
      ) : (
        <>
          {visit}
          <View style={styles.actions}>
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
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { gap: Spacing.two },
});
