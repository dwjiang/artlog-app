import { ImageSkeleton } from '@/components/loading-skeleton';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ConfidenceChip } from './confidence-chip';
import { CornersOverlay } from './corners-overlay';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { ResultKind } from '@/lib/result/state';
import { previewGeometry } from '@/lib/capture/preview-geometry';

export type CardHeaderProps = {
  /** The user's unpadded artwork preview. */
  cropUri?: string;
  artworkTitle?: string;
  loading?: boolean;
  corners?: number[][];
  inputSize: number;
  kind: ResultKind;
  onNotRight?: () => void;
};

export function CardHeader({ cropUri, artworkTitle, loading = false, corners, inputSize, kind, onNotRight }: CardHeaderProps) {
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [preview, setPreview] = useState<{ uri: string; width: number; height: number }>();
  const [failedUri, setFailedUri] = useState<string>();
  const available = cropUri && failedUri !== cropUri;
  const geometry = preview?.uri === cropUri && preview ? previewGeometry(preview, frame, inputSize) : null;
  return (
    <View style={styles.header}>
      <View style={styles.frame} onLayout={({ nativeEvent: { layout } }) => setFrame({ width: layout.width, height: layout.height })}>
      {available ? (
        <Image source={cropUri} contentFit="contain" accessibilityLabel="Your photo of this painting" style={styles.photo}
          onLoad={({ source }) => setPreview({ uri: cropUri, width: source.width, height: source.height })} onError={() => setFailedUri(cropUri)} />
      ) : loading ? <ImageSkeleton style={{ width: '100%', height: '100%' }} /> : (
        <View style={styles.placeholder}>
          <Image source="sf:photo" tintColor={Colors.light.textSecondary} style={styles.placeholderIcon} />
          <ThemedText type="smallBold" style={styles.placeholderText}>Photo unavailable</ThemedText>
          {artworkTitle && <ThemedText themeColor="textSecondary" style={styles.placeholderText}>{artworkTitle}</ThemedText>}
        </View>
      )}
      {available && geometry && <View pointerEvents="none" style={[styles.overlay, geometry.artwork]}>
        <View style={[styles.overlay, geometry.model]}><CornersOverlay corners={corners} inputSize={inputSize} size={geometry.model.width} /></View>
      </View>}
      </View>
      {kind !== 'loading' && <View style={styles.status}><ConfidenceChip kind={kind} />
        {onNotRight && <Pressable accessibilityRole="button" onPress={onNotRight} hitSlop={8} style={styles.correction}>
          <ThemedText variant="secondary" themeColor="accent">Not right?</ThemedText>
        </Pressable>}
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.one },
  frame: { width: '100%', aspectRatio: 1.15, justifyContent: 'center', overflow: 'hidden', backgroundColor: Colors.light.backgroundElement },
  photo: { width: '100%', height: '100%' },
  overlay: { position: 'absolute', overflow: 'hidden' },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  correction: { minHeight: 44, justifyContent: 'center' },
  placeholder: { alignItems: 'center', padding: 20, gap: Spacing.two },
  placeholderIcon: { width: 32, height: 32 },
  placeholderText: { alignSelf: 'stretch', textAlign: 'center' },
});
