import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export function VenuePickerSheet() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">Looks like you&apos;re at…</ThemedText>
      <ThemedText themeColor="textSecondary">
        Confirm the museum so scans are matched against its collection.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
