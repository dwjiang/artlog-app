import { ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export type SavedWorkScreenProps = {
  savedId: string;
};

export function SavedWorkScreen({ savedId }: SavedWorkScreenProps) {
  return (
    <ThemedView style={styles.container}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">Saved work</ThemedText>
        <ThemedText themeColor="textSecondary">
          The snapshot you saved, exactly as it was identified.
        </ThemedText>
        <ThemedText type="code">{savedId}</ThemedText>
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
