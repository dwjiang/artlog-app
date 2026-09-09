import { Link } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export function CollectionScreen() {
  return (
    <ThemedView style={styles.container}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">Collection</ThemedText>
        <ThemedText themeColor="textSecondary">
          Works you have saved and the visits they came from.
        </ThemedText>
        {/* Placeholder navigation; removed by docs/plans/05-app-ui/* */}
        <Link href="/demo">
          <ThemedText type="link">Open saved work</ThemedText>
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
