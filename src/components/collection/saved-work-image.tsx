import { Image } from "expo-image";
import { useNetworkState } from "expo-network";
import { useState } from "react";
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";

import { ImageSkeleton } from "@/components/loading-skeleton";
import { ThemedText } from "@/components/themed-text";
import { Gallery, Spacing } from "@/constants/theme";
import { captureFileUri } from "@/lib/files/photos";
import { reportError } from "@/lib/observability";

export function SavedWorkImage({
  path,
  title,
  style,
  contain = false,
  syncing = false,
  onLoad,
}: {
  path: string | null;
  title: string;
  style: StyleProp<ViewStyle>;
  contain?: boolean;
  syncing?: boolean;
  onLoad?: (size: { width: number; height: number }) => void;
}) {
  const [failedPath, setFailedPath] = useState<string>();
  const [loadedPath, setLoadedPath] = useState<string>();
  const [size, setSize] = useState<{ width: number; height: number }>();
  const { fontScale } = useWindowDimensions();
  const frame = StyleSheet.flatten(style);
  const width = size?.width ?? (typeof frame?.width === "number" ? frame.width : 0);
  const height =
    size?.height
    ?? (typeof frame?.height === "number"
      ? frame.height
      : typeof frame?.aspectRatio === "number"
        ? width / frame.aspectRatio
        : 0);
  const compact = width < 120 * fontScale || height < 96 * fontScale;
  const status = path ? "Image unavailable" : "No photo";
  return (
    <View
      style={[styles.container, style]}
      onLayout={({ nativeEvent }) => {
        const { width, height } = nativeEvent.layout;
        setSize((previous) => (previous?.width === width && previous.height === height ? previous : { width, height }));
      }}
    >
      {path && failedPath !== path ? (
        <Image
          cachePolicy="memory"
          source={captureFileUri(path)}
          contentFit={contain ? "contain" : "cover"}
          onLoad={({ source }) => {
            setLoadedPath(path);
            if (source.width > 0 && source.height > 0) onLoad?.(source);
          }}
          onError={(event) => {
            reportError(new Error(event?.error || "Saved artwork photo could not load"), "collection.photo.load", {
              level: "warning",
            });
            setFailedPath(path);
          }}
          accessibilityLabel={`Your photo of ${title}`}
          style={StyleSheet.absoluteFill}
        />
      ) : !path && syncing ? (
        <PhotoDownload title={title} compact={compact} />
      ) : (
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${title}: ${status.toLowerCase()}`}
          style={[StyleSheet.absoluteFill, styles.placeholder, compact && { padding: 0 }]}
        >
          <Image
            source="sf:photo"
            accessible={false}
            tintColor={Gallery.muted}
            style={{ width: compact ? 18 : 28, height: compact ? 18 : 28 }}
          />
          {!compact && (
            <ThemedText
              accessible={false}
              variant="metadata"
              themeColor="textSecondary"
              style={{ textAlign: "center" }}
            >
              {status}
            </ThemedText>
          )}
        </View>
      )}
      {path && failedPath !== path && loadedPath !== path && (
        <ImageSkeleton label={`Loading photo: ${title}`} style={StyleSheet.absoluteFill} />
      )}
    </View>
  );
}

function PhotoDownload({ title, compact }: { title: string; compact: boolean }) {
  const network = useNetworkState();
  if (network.isConnected === false || network.isInternetReachable === false) {
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${title}: photo waiting for connection`}
        style={[StyleSheet.absoluteFill, styles.placeholder]}
      >
        <Image source="sf:wifi.slash" accessible={false} tintColor={Gallery.muted} style={{ width: 24, height: 24 }} />
        {!compact && (
          <ThemedText variant="metadata" themeColor="textSecondary">
            Photo available when online
          </ThemedText>
        )}
      </View>
    );
  }
  return <ImageSkeleton label={`Downloading photo: ${title}`} style={StyleSheet.absoluteFill} />;
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 2,
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    padding: Spacing.two,
    backgroundColor: Gallery.fill,
  },
});
