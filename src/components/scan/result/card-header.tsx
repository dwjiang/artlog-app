import { ImageSkeleton } from '@/components/loading-skeleton';
import { reportError } from '@/lib/observability';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ConfidenceChip } from './confidence-chip';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { ResultKind } from '@/lib/result/state';

export type CardHeaderProps = {
  /** The user's unpadded artwork preview. */
  cropUri?: string;
  artworkTitle?: string;
  loading?: boolean;
  kind: ResultKind;
  onNotRight?: () => void;
};

export function CardHeader({ cropUri, artworkTitle, loading = false, kind, onNotRight }: CardHeaderProps) {
  const [failedUri, setFailedUri] = useState<string>();
  const available = cropUri && failedUri !== cropUri;
  return (
    <View style={styles.header}>
      <View style={styles.frame}>
      {available ? (
        <Image source={cropUri} contentFit="contain" accessibilityLabel="Your photo of this painting" style={styles.photo}
          onError={(event) => { reportError(new Error(event?.error ?? 'Painting preview unavailable'), 'result.load_preview', { level: 'warning' }); setFailedUri(cropUri); }} />
      ) : loading ? <ImageSkeleton style={{ width: '100%', height: '100%' }} /> : (
        <View style={styles.placeholder}>
          <Image source="sf:photo" tintColor={Colors.light.textSecondary} style={styles.placeholderIcon} />
          <ThemedText type="smallBold" style={styles.placeholderText}>Photo unavailable</ThemedText>
          {artworkTitle && <ThemedText themeColor="textSecondary" style={styles.placeholderText}>{artworkTitle}</ThemedText>}
        </View>
      )}
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
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  correction: { minHeight: 44, justifyContent: 'center' },
  placeholder: { alignItems: 'center', padding: 20, gap: Spacing.two },
  placeholderIcon: { width: 32, height: 32 },
  placeholderText: { alignSelf: 'stretch', textAlign: 'center' },
});
