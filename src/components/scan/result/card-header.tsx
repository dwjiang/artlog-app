import { ImageSkeleton } from '@/components/loading-skeleton';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConfidenceChip } from './confidence-chip';
import { CornersOverlay } from './corners-overlay';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { ResultKind } from '@/lib/result/state';

export type CardHeaderProps = {
  /** The user's own crop; the card never shows a museum image here. */
  cropUri?: string;
  artworkTitle?: string;
  loading?: boolean;
  corners?: number[][];
  inputSize: number;
  kind: ResultKind;
};

export function CardHeader({ cropUri, artworkTitle, loading = false, corners, inputSize, kind }: CardHeaderProps) {
  const [size, setSize] = useState(0);
  const [failedUri, setFailedUri] = useState<string>();
  const available = cropUri && failedUri !== cropUri;
  return (
    <View style={styles.header}>
      <View style={[styles.frame, { minHeight: size }]} onLayout={(event) => setSize(event.nativeEvent.layout.width)}>
      {available ? (
        <Image source={cropUri} contentFit="contain" accessibilityLabel="Your photo of this painting" style={styles.photo} onError={() => setFailedUri(cropUri)} />
      ) : loading ? <ImageSkeleton style={{ width: '100%', aspectRatio: 1 }} /> : (
        <View style={styles.placeholder}>
          <Image source="sf:photo" tintColor={Colors.light.textSecondary} style={styles.placeholderIcon} />
          <ThemedText type="smallBold" style={styles.placeholderText}>Photo unavailable</ThemedText>
          {artworkTitle && <ThemedText themeColor="textSecondary" style={styles.placeholderText}>{artworkTitle}</ThemedText>}
        </View>
      )}
      {available && size > 0 && <CornersOverlay corners={corners} inputSize={inputSize} size={size} />}
      </View>
      <ConfidenceChip kind={kind} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.three },
  frame: { width: '100%', justifyContent: 'center', overflow: 'hidden', backgroundColor: Colors.light.backgroundElement },
  photo: { width: '100%', aspectRatio: 1 },
  placeholder: { alignItems: 'center', padding: 20, gap: Spacing.two },
  placeholderIcon: { width: 32, height: 32 },
  placeholderText: { alignSelf: 'stretch', textAlign: 'center' },
});
