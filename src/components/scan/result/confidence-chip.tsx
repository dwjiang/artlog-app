import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Gallery, Spacing } from '@/constants/theme';
import type { ResultKind } from '@/lib/result/state';

// Product voice: a soft match is a "Maybe", never presented as fact.
export const CONFIDENCE_LABELS: Partial<Record<ResultKind, string>> = {
  confident: 'Match', soft: 'Maybe', unidentified: 'Unidentified', unsupported: 'Update required', failed: 'Identification failed',
};

export function ConfidenceChip({ kind, style }: { kind: ResultKind; style?: StyleProp<ViewStyle> }) {
  const label = CONFIDENCE_LABELS[kind];
  if (!label) return null;
  const color = kind === 'confident' ? Colors.light.success : kind === 'failed' ? Gallery.destructive : Colors.light.warning;
  return (
    <View style={[styles.chip, { borderColor: color }, style]}>
      <ThemedText type="smallBold" style={{ color }}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start', paddingHorizontal: Spacing.two, paddingVertical: Spacing.one,
    borderRadius: 2, borderWidth: 1, backgroundColor: Colors.light.background,
  },
});
