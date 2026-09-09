import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export type LabelCaptureScreenProps = {
  scanId: string;
};

export function LabelCaptureScreen({ scanId }: LabelCaptureScreenProps) {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">Point at the label</ThemedText>
      <ThemedText themeColor="textSecondary">
        Frame the wall label so the title and artist are readable.
      </ThemedText>
      <ThemedText type="code">{scanId}</ThemedText>
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
