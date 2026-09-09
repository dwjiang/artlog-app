import { Link } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export function ScanScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.content}>
        <ThemedText type="subtitle">Scan</ThemedText>
        <ThemedText themeColor="textSecondary">
          Point the camera at a painting to identify it.
        </ThemedText>
        {/* Placeholder navigation; removed by docs/plans/05-app-ui/* */}
        <Link href="/result/demo">
          <ThemedText type="link">Open result</ThemedText>
        </Link>
        <Link href="/label/demo">
          <ThemedText type="link">Open label capture</ThemedText>
        </Link>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
