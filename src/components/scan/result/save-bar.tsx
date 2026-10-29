import { Image } from "expo-image";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { ActionStack } from "@/components/action-stack";
import { GalleryButton } from "@/components/collection/gallery-button";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
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
  /** Opens the copy of this work already in the collection, which marks the work as saved. */
  onViewInCollection?: () => void;
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
  onViewInCollection,
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
              {onViewInCollection && (
                <View style={styles.inCollection}>
                  <Image
                    source="sf:bookmark.fill"
                    tintColor={Gallery.accent}
                    accessible={false}
                    style={styles.savedIcon}
                  />
                  <ThemedText variant="secondary" style={styles.savedLabel}>
                    In your collection
                  </ThemedText>
                  <MotionPressable
                    accessibilityRole="button"
                    accessibilityLabel="View in your collection"
                    onPress={onViewInCollection}
                    hitSlop={8}
                    style={styles.view}
                  >
                    <ThemedText variant="secondary" themeColor="accent">
                      View
                    </ThemedText>
                  </MotionPressable>
                </View>
              )}
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
  inCollection: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  savedIcon: { width: 14, height: 14 },
  savedLabel: { flex: 1, color: Gallery.accent, fontWeight: "600" },
  view: { minHeight: 44, justifyContent: "center" },
});
