import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** A tappable citation: the source's label, opening its page in the in-app browser. */
export function SourceChip({ label, url }: { label: string; url: string }) {
  const [failed, setFailed] = useState(false);
  async function openSource() {
    setFailed(false);
    try {
      await openBrowserAsync(url);
    } catch {
      setFailed(true);
    }
  }
  return (
    <View>
    <Pressable accessibilityRole="link" onPress={() => { void openSource(); }} style={styles.chip}>
      <ThemedText type="small" themeColor="accent">{label}</ThemedText>
    </Pressable>
    {failed && <ThemedText type="small" themeColor="error" accessibilityRole="alert">Couldn’t open this source. Tap the source to try again.</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingVertical: Spacing.two,
  },
});
