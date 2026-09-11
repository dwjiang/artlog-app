import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { ResultKind } from '@/lib/result/state';

// Product voice (design §4.4): a soft match is a "Maybe", never presented as fact.
export const CONFIDENCE_LABELS: Partial<Record<ResultKind, string>> = {
  confident: 'Match', soft: 'Maybe', unidentified: 'Unidentified',
};

export function ConfidenceChip({ kind, style }: { kind: ResultKind; style?: StyleProp<ViewStyle> }) {
  const label = CONFIDENCE_LABELS[kind];
  if (!label) return null;
  return (
    <View style={[styles.chip, style]}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start', paddingHorizontal: Spacing.three, paddingVertical: Spacing.one,
    borderRadius: Spacing.three, backgroundColor: Colors.light.background,
  },
});
