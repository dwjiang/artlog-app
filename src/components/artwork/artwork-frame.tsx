import { Image, type ImageProps } from "expo-image";
import { useState, type ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { ImageSkeleton } from "@/components/loading-skeleton";
import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";

/**
 * An artwork's picture at the top of its page, as tall as the picture up to about a third of the screen, so the
 * title follows right under it. `children` are laid over the frame's bottom corner (the scan card's crop button).
 */
export function ArtworkFrame({
  uri,
  loading = false,
  accessibilityLabel,
  unavailableText = "Photo unavailable",
  unavailableTitle,
  cachePolicy,
  maxHeight: heightCap,
  onError,
  children,
}: {
  uri?: string;
  loading?: boolean;
  accessibilityLabel: string;
  unavailableText?: string;
  /** Named under `unavailableText` when the picture is missing. */
  unavailableTitle?: string;
  cachePolicy?: ImageProps["cachePolicy"];
  /** A lower cap where two frames share the screen. */
  maxHeight?: number;
  onError?: (message?: string) => void;
  children?: ReactNode;
}) {
  const frameHeight = useArtworkFrameHeight();
  const maxHeight = Math.min(frameHeight, heightCap ?? frameHeight);
  const [failedUri, setFailedUri] = useState<string>();
  const [shape, setShape] = useState<{ uri: string; aspectRatio: number }>();
  const available = !!uri && failedUri !== uri;
  // Until the picture reports its size the frame keeps its full height, so a slow load doesn't push the page down.
  const aspectRatio = available && shape?.uri === uri ? shape.aspectRatio : undefined;
  return (
    <View
      style={[
        styles.frame,
        aspectRatio ? { aspectRatio, maxHeight } : { height: maxHeight },
        !available && styles.empty,
      ]}
    >
      {available ? (
        <Image
          cachePolicy={cachePolicy}
          source={uri}
          contentFit="contain"
          accessibilityLabel={accessibilityLabel}
          style={styles.photo}
          onLoad={({ source }) => {
            if (source.width > 0 && source.height > 0) setShape({ uri, aspectRatio: source.width / source.height });
          }}
          onError={(event) => {
            onError?.(event?.error);
            setFailedUri(uri);
          }}
        />
      ) : loading ? (
        <ImageSkeleton style={{ width: "100%", height: "100%" }} />
      ) : (
        <View style={styles.placeholder}>
          <Image source="sf:photo" tintColor={Colors.light.textSecondary} style={styles.placeholderIcon} />
          <ThemedText type="smallBold" style={styles.placeholderText}>
            {unavailableText}
          </ThemedText>
          {unavailableTitle && (
            <ThemedText themeColor="textSecondary" style={styles.placeholderText}>
              {unavailableTitle}
            </ThemedText>
          )}
        </View>
      )}
      {children}
    </View>
  );
}

/** The tallest an artwork page's picture grows, so the title stays close under it. */
export function useArtworkFrameHeight() {
  const { height, fontScale } = useWindowDimensions();
  return Math.min(360, height * (fontScale > 1.4 ? 0.25 : 0.36));
}

const styles = StyleSheet.create({
  // A tall picture narrows the frame to its own width; centering keeps it where the full-width frame drew it.
  frame: { width: "100%", alignSelf: "center", justifyContent: "center", overflow: "hidden" },
  empty: { backgroundColor: Colors.light.backgroundElement },
  photo: { width: "100%", height: "100%" },
  placeholder: { alignItems: "center", padding: 20, gap: Spacing.two },
  placeholderIcon: { width: 32, height: 32 },
  placeholderText: { alignSelf: "stretch", textAlign: "center" },
});
