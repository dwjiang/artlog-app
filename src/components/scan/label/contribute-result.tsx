import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { ContributionOutcome } from '@/lib/label/contribute';

export const CONTRIBUTION_MESSAGES = {
  private: 'Thanks — shared privately until it’s verified',
  pending: 'Thanks — this work is waiting for a second confirmation',
  promoted: 'Thanks — this work is in the shared index',
  duplicate: 'This work is already in the shared index — thanks anyway',
  rejected: 'This contribution couldn’t be accepted',
} as const;

export function contributionMessage(result: ContributionOutcome): string {
  if (result.status === 'rejected') return CONTRIBUTION_MESSAGES[result.reason === 'duplicate' ? 'duplicate' : 'rejected'];
  return CONTRIBUTION_MESSAGES[result.status];
}

export function ContributeResult({ result }: { result: ContributionOutcome }) {
  return (
    <View style={styles.note} accessibilityRole="text">
      <ThemedText>{contributionMessage(result)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { padding: Spacing.three, borderRadius: Spacing.two, backgroundColor: Colors.light.backgroundElement },
});
