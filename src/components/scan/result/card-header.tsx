import { ImageSkeleton } from "@/components/loading-skeleton";
import { reportError } from "@/lib/observability";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ConfidenceChip } from "./confidence-chip";
import { ThemedText } from "@/components/themed-text";
import { Colors, Gallery, Radius, Spacing } from "@/constants/theme";
import type { ResultKind } from "@/lib/result/state";

export type CardHeaderProps = {
  /** The user's unpadded artwork preview. */
  cropUri?: string;
  artworkTitle?: string;
  loading?: boolean;
  kind: ResultKind;
  onNotRight?: () => void;
  onAdjustCrop?: () => void;
};

const FALLBACK_ASPECT = 1.15;

// Tall paintings stop at 3:4 so the title stays in view; panoramas stop at 2:1.
export function photoFrameAspect(width: number, height: number) {
  if (!width || !height) return FALLBACK_ASPECT;
  return Math.min(2, Math.max(0.75, width / height));
}

export function CardHeader({
  cropUri,
  artworkTitle,
  loading = false,
  kind,
  onNotRight,
  onAdjustCrop,
}: CardHeaderProps) {
  const [failedUri, setFailedUri] = useState<string>();
  const [loaded, setLoaded] = useState<{ uri?: string; aspect: number }>();
  const available = cropUri && failedUri !== cropUri;
  const aspectRatio = available && loaded?.uri === cropUri ? loaded.aspect : FALLBACK_ASPECT;
  return (
    <View style={styles.header}>
      <View style={[styles.frame, { aspectRatio }]}>
        {available ? (
          <Image
            source={cropUri}
            contentFit="contain"
            accessibilityLabel="Your photo of this painting"
            style={styles.photo}
            onLoad={({ source }) =>
              setLoaded({ uri: cropUri, aspect: photoFrameAspect(source.width, source.height) })
            }
            onError={(event) => {
              reportError(
                new Error(event?.error ?? "Painting preview unavailable"),
                "result.load_preview",
                { level: "warning" },
              );
              setFailedUri(cropUri);
            }}
          />
        ) : loading ? (
          <ImageSkeleton style={{ width: "100%", height: "100%" }} />
        ) : (
          <View style={styles.placeholder}>
            <Image
              source="sf:photo"
              tintColor={Colors.light.textSecondary}
              style={styles.placeholderIcon}
            />
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Adjust crop"
            onPress={onAdjustCrop}
            style={({ pressed }) => [styles.crop, pressed && styles.pressed]}
          >
            <Image source="sf:crop" tintColor={Gallery.ink} style={styles.cropIcon} />
          </Pressable>
        )}
      </View>
      {kind !== "loading" && (
        <View style={styles.status}>
          <ConfidenceChip kind={kind} />
          {onNotRight && (
            <Pressable
              accessibilityRole="button"
              onPress={onNotRight}
              hitSlop={8}
              style={styles.correction}
            >
              <ThemedText variant="secondary" themeColor="accent">
                Not right?
              </ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.one },
  frame: {
    width: "100%",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: Colors.light.backgroundElement,
  },
  photo: { width: "100%", height: "100%" },
  crop: {
    position: "absolute",
    right: Spacing.compact,
    bottom: Spacing.compact,
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Gallery.surface,
    boxShadow: "0 1px 6px rgba(17,17,17,0.18)",
  },
  pressed: { opacity: 0.6 },
  cropIcon: { width: 20, height: 20 },
  status: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  correction: { minHeight: 44, justifyContent: "center" },
  placeholder: { alignItems: "center", padding: 20, gap: Spacing.two },
  placeholderIcon: { width: 32, height: 32 },
  placeholderText: { alignSelf: "stretch", textAlign: "center" },
});
