import { Link } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export function SettingsScreen() {
  return (
    <ThemedView style={styles.container}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">Settings</ThemedText>
        <ThemedText themeColor="textSecondary">
          Sharing, your optional account, and export.
        </ThemedText>
        {/* Placeholder navigation; removed by docs/plans/05-app-ui/* */}
        <Link href="/venue-picker">
          <ThemedText type="link">Open venue picker</ThemedText>
        </Link>
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
