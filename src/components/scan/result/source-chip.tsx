import { openBrowserAsync } from 'expo-web-browser';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';

/** A tappable citation: the source's label, opening its page in the in-app browser. */
export function SourceChip({ label, url }: { label: string; url: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={() => { void openBrowserAsync(url); }} style={styles.chip}>
      <ThemedText type="small" themeColor="accent">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start', paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.three,
    backgroundColor: Colors.light.backgroundElement,
  },
});
