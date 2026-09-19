import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Gallery, Spacing } from '@/constants/theme';
import { captureFileUri } from '@/lib/files/photos';
import { ImageSkeleton } from '@/components/loading-skeleton';

export function SavedWorkImage({ path, title, style, contain = false, syncing = false, onLoad }: {
  path: string | null; title: string; style: StyleProp<ViewStyle>; contain?: boolean; syncing?: boolean;
  onLoad?: (size: { width: number; height: number }) => void;
}) {
  const [failedPath, setFailedPath] = useState<string>();
  const [loadedPath, setLoadedPath] = useState<string>();
  const [size, setSize] = useState<{ width: number; height: number }>();
  const { fontScale } = useWindowDimensions();
  const frame = StyleSheet.flatten(style);
  const width = size?.width ?? (typeof frame?.width === 'number' ? frame.width : 0);
  const height = size?.height ?? (typeof frame?.height === 'number' ? frame.height
    : typeof frame?.aspectRatio === 'number' ? width / frame.aspectRatio : 0);
  const compact = width < 120 * fontScale || height < 96 * fontScale;
  const status = path ? 'Image unavailable' : syncing ? 'Photo syncing' : 'No photo';
  return (
    <View style={[styles.container, style]} onLayout={({ nativeEvent }) => {
      const { width, height } = nativeEvent.layout;
      setSize((previous) => previous?.width === width && previous.height === height ? previous : { width, height });
    }}>
      {path && failedPath !== path ? <Image source={captureFileUri(path)} contentFit={contain ? 'contain' : 'cover'}
        onLoad={({ source }) => { setLoadedPath(path); if (source.width > 0 && source.height > 0) onLoad?.(source); }}
        onError={() => setFailedPath(path)}
        accessibilityLabel={`Your photo of ${title}`} style={StyleSheet.absoluteFill} />
        : <View accessible accessibilityRole="image" accessibilityLabel={`${title}: ${status.toLowerCase()}`} style={[StyleSheet.absoluteFill, styles.placeholder, compact && { padding: 0 }]}>
          <Image source="sf:photo" accessible={false} tintColor={Gallery.muted} style={{ width: compact ? 18 : 28, height: compact ? 18 : 28 }} />
          {!compact && <ThemedText accessible={false} variant="metadata" themeColor="textSecondary" style={{ textAlign: 'center' }}>{status}{!path && syncing ? '…' : ''}</ThemedText>}
        </View>}
      {path && failedPath !== path && loadedPath !== path && <ImageSkeleton label={`Loading photo: ${title}`} style={StyleSheet.absoluteFill} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: Gallery.fill, borderRadius: 2 },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.two },
});
