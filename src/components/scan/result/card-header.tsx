import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConfidenceChip } from './confidence-chip';
import { CornersOverlay } from './corners-overlay';
import { Colors, Spacing } from '@/constants/theme';
import type { ResultKind } from '@/lib/result/state';

export type CardHeaderProps = {
  /** The user's own crop; the card never shows a museum image here. */
  cropUri?: string;
  corners?: number[][];
  inputSize: number;
  kind: ResultKind;
};

export function CardHeader({ cropUri, corners, inputSize, kind }: CardHeaderProps) {
  const [size, setSize] = useState(0);
  return (
    <View style={styles.frame} onLayout={(event) => setSize(event.nativeEvent.layout.width)}>
      {cropUri ? (
        <Image source={cropUri} contentFit="contain" accessibilityLabel="Your photo of this painting" style={styles.photo} />
      ) : (
        <View style={styles.photo} />
      )}
      {size > 0 && <CornersOverlay corners={corners} inputSize={inputSize} size={size} />}
      <ConfidenceChip kind={kind} style={styles.chip} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 1, borderRadius: Spacing.two, overflow: 'hidden', backgroundColor: Colors.light.backgroundElement },
  photo: { width: '100%', height: '100%' },
  chip: { position: 'absolute', top: Spacing.three, left: Spacing.three },
});
