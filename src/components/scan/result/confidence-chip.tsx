import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Gallery, Radius, Spacing } from '@/constants/theme';
import type { ResultKind } from '@/lib/result/state';

// Product voice: a soft match is a "Maybe", never presented as fact. The calibrator
// probability stays off this chip: its confident threshold sits near 0.14, so the
// number would contradict the word in either direction.
export const CONFIDENCE_LABELS: Partial<Record<ResultKind, string>> = {
  confident: 'Match', soft: 'Maybe', unidentified: 'Unidentified', unsupported: 'Update required', failed: 'Identification failed',
};

export function ConfidenceChip({ kind, style }: { kind: ResultKind; style?: StyleProp<ViewStyle> }) {
  const label = CONFIDENCE_LABELS[kind];
  if (!label) return null;
  const hasMatch = kind === 'confident' || kind === 'soft';
  return (
    <View style={[styles.chip, hasMatch && styles.match, style]}>
      <ThemedText type="smallBold" style={kind === 'failed' ? styles.failed : undefined}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start', paddingHorizontal: Spacing.compact, paddingVertical: Spacing.one,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Gallery.ink, backgroundColor: Gallery.fill,
  },
  match: { backgroundColor: Gallery.highlight },
  failed: { color: Gallery.destructive },
});
