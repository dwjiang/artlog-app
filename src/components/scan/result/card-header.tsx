import { Image } from "expo-image";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { ArtworkFrame } from "@/components/artwork/artwork-frame";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Radius, Spacing } from "@/constants/theme";
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
  const { fontScale } = useWindowDimensions();
  return (
    <View style={styles.header}>
      <ArtworkFrame
        uri={cropUri}
        loading={loading}
        cachePolicy="memory"
        accessibilityLabel="Your photo of this painting"
        unavailableTitle={artworkTitle}
        onError={(message) =>
          reportError(new Error(message ?? "Painting preview unavailable"), "result.load_preview", { level: "warning" })
        }
      >
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
      </ArtworkFrame>
      {kind !== "loading" && (
        <View
          style={[
            styles.status,
            // Cards that can offer a correction keep its height, so hiding the link during a save doesn't shift them.
            (kind === "confident" || kind === "soft" || kind === "confirmed") && styles.correctionRow,
            fontScale > 1.4 && styles.stackedStatus,
          ]}
        >
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
  },
  correctionRow: { minHeight: 44 },
  correction: { minHeight: 44, justifyContent: "center" },
  stackedStatus: { flexDirection: "column", alignItems: "flex-start" },
});
