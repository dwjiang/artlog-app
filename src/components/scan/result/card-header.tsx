import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { ImageSkeleton } from "@/components/loading-skeleton";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText } from "@/components/themed-text";
import { Colors, Gallery, Radius, Spacing } from "@/constants/theme";
import { reportError } from "@/lib/observability";
import type { ResultKind } from "@/lib/result/state";

import type { ConfirmedSource } from "../../../../convex/lib/validators";
import { ConfidenceChip } from "./confidence-chip";

export type CardHeaderProps = {
  /** The user's unpadded artwork preview. */
  cropUri?: string;
  artworkTitle?: string;
  loading?: boolean;
  kind: ResultKind;
  probability?: number;
  source?: ConfirmedSource;
  onNotRight?: () => void;
  /** Reopens the owner's confirmed details; replaces "Not right?" on a confirmed card. */
  onEditDetails?: () => void;
  onAdjustCrop?: () => void;
};

export function CardHeader({
  cropUri,
  artworkTitle,
  loading = false,
  kind,
  probability,
  source,
  onNotRight,
  onEditDetails,
  onAdjustCrop,
}: CardHeaderProps) {
  const correction = onEditDetails
    ? { label: "Edit details", onPress: onEditDetails }
    : onNotRight && { label: "Not right?", onPress: onNotRight };
  const [failedUri, setFailedUri] = useState<string>();
  const { height, fontScale } = useWindowDimensions();
  const available = cropUri && failedUri !== cropUri;
  return (
    <View style={styles.header}>
      <View
        style={[
          styles.frame,
          { height: Math.min(360, height * (fontScale > 1.4 ? 0.25 : 0.36)) },
          !available && styles.empty,
        ]}
      >
        {available ? (
          <Image
            cachePolicy="memory"
            source={cropUri}
            contentFit="contain"
            accessibilityLabel="Your photo of this painting"
            style={styles.photo}
            onError={(event) => {
              reportError(new Error(event?.error ?? "Painting preview unavailable"), "result.load_preview", {
                level: "warning",
              });
              setFailedUri(cropUri);
            }}
          />
        ) : loading ? (
          <ImageSkeleton style={{ width: "100%", height: "100%" }} />
        ) : (
          <View style={styles.placeholder}>
            <Image source="sf:photo" tintColor={Colors.light.textSecondary} style={styles.placeholderIcon} />
            <ThemedText type="smallBold" style={styles.placeholderText}>
              Photo unavailable
            </ThemedText>
            {artworkTitle && (
              <ThemedText themeColor="textSecondary" style={styles.placeholderText}>
                {artworkTitle}
              </ThemedText>
            )}
          </View>
        )}
        {onAdjustCrop && (
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="Adjust crop"
            onPress={onAdjustCrop}
            style={styles.crop}
          >
            <Image source="sf:crop" tintColor={Gallery.ink} style={styles.cropIcon} />
          </MotionPressable>
        )}
      </View>
      {kind !== "loading" && (
        <View style={[styles.status, fontScale > 1.4 && styles.stackedStatus]}>
          <ConfidenceChip kind={kind} probability={probability} source={source} />
          {correction && (
            <MotionPressable
              accessibilityRole="button"
              onPress={correction.onPress}
              hitSlop={8}
              style={styles.correction}
            >
              <ThemedText variant="secondary" themeColor="accent">
                {correction.label}
              </ThemedText>
            </MotionPressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.two },
  frame: {
    width: "100%",
    justifyContent: "center",
    overflow: "hidden",
  },
  empty: { backgroundColor: Colors.light.backgroundElement },
  photo: { width: "100%", height: "100%" },
  crop: {
    position: "absolute",
    right: Spacing.compact,
    bottom: Spacing.compact,
    width: 44,
    height: 44,
    borderRadius: Radius.button,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Gallery.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gallery.separator,
  },
  cropIcon: { width: 20, height: 20 },
  status: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  correction: { minHeight: 44, justifyContent: "center" },
  stackedStatus: { flexDirection: "column", alignItems: "flex-start" },
  placeholder: { alignItems: "center", padding: 20, gap: Spacing.two },
  placeholderIcon: { width: 32, height: 32 },
  placeholderText: { alignSelf: "stretch", textAlign: "center" },
});
