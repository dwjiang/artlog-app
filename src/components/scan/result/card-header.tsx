import { ImageSkeleton } from '@/components/loading-skeleton';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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
  onNotRight?: () => void;
};

export function CardHeader({ cropUri, artworkTitle, loading = false, corners, inputSize, kind, onNotRight }: CardHeaderProps) {
  const [size, setSize] = useState(0);
  const [failedUri, setFailedUri] = useState<string>();
  const available = cropUri && failedUri !== cropUri;
  return (
    <View style={styles.header}>
      <View style={styles.frame} onLayout={(event) => setSize(event.nativeEvent.layout.width)}>
      {available ? (
        <Image source={cropUri} contentFit="contain" accessibilityLabel="Your photo of this painting" style={styles.photo} onError={() => setFailedUri(cropUri)} />
      ) : loading ? <ImageSkeleton style={{ width: '100%', height: '100%' }} /> : (
        <View style={styles.placeholder}>
          <Image source="sf:photo" tintColor={Colors.light.textSecondary} style={styles.placeholderIcon} />
          <ThemedText type="smallBold" style={styles.placeholderText}>Photo unavailable</ThemedText>
          {artworkTitle && <ThemedText themeColor="textSecondary" style={styles.placeholderText}>{artworkTitle}</ThemedText>}
        </View>
      )}
      {available && size > 0 && <View pointerEvents="none" style={{ position: 'absolute', width: size / 1.15, height: size / 1.15, top: 0, left: (size - size / 1.15) / 2 }}>
        <CornersOverlay corners={corners} inputSize={inputSize} size={size / 1.15} />
      </View>}
      </View>
      <View style={styles.status}><ConfidenceChip kind={kind} />
        {onNotRight && <Pressable accessibilityRole="button" onPress={onNotRight} hitSlop={8} style={styles.correction}>
          <ThemedText variant="secondary" themeColor="accent">Not right?</ThemedText>
        </Pressable>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.one },
  frame: { width: '100%', aspectRatio: 1.15, justifyContent: 'center', overflow: 'hidden', backgroundColor: Colors.light.backgroundElement },
  photo: { width: '100%', height: '100%' },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  correction: { minHeight: 44, justifyContent: 'center' },
  placeholder: { alignItems: 'center', padding: 20, gap: Spacing.two },
  placeholderIcon: { width: 32, height: 32 },
  placeholderText: { alignSelf: 'stretch', textAlign: 'center' },
});
