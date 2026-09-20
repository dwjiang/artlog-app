import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Gallery, Spacing } from '@/constants/theme';
import type { ContributionOutcome } from '@/lib/label/contribute';

export const CONTRIBUTION_MESSAGES = {
  tentative: 'Saved to the shared index as a tentative match for other visitors at this museum.',
  duplicate: 'This work is already in the shared index — thanks anyway',
  rejected: 'This contribution couldn’t be accepted',
} as const;

export function contributionMessage(result: ContributionOutcome): string {
  if (result.status === 'rejected') return CONTRIBUTION_MESSAGES[result.reason === 'duplicate' ? 'duplicate' : 'rejected'];
  return CONTRIBUTION_MESSAGES[result.status];
}

export function ContributeResult({ result }: { result: ContributionOutcome }) {
  const rejected = result.status === 'rejected' && result.reason !== 'duplicate';
  const color = rejected ? Gallery.destructive : Colors.light.warning;
  return (
    <View style={[styles.note, { borderLeftColor: color }]} accessibilityRole="text" accessibilityLiveRegion="polite">
      <ThemedText type="smallBold" style={{ color }}>{rejected ? 'Contribution not accepted' : result.status === 'tentative' ? 'Tentative contribution' : 'Already in the index'}</ThemedText>
      <ThemedText>{contributionMessage(result)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { gap: Spacing.two, padding: Spacing.three, borderLeftWidth: 3, backgroundColor: Colors.light.backgroundElement },
});
