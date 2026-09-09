import { ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export type ResultScreenProps = {
  scanId: string;
};

export function ResultScreen({ scanId }: ResultScreenProps) {
  return (
    <ThemedView style={styles.container}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">Result</ThemedText>
        <ThemedText themeColor="textSecondary">
          The identified work and its docent notes will appear here.
        </ThemedText>
        <ThemedText type="code">{scanId}</ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
