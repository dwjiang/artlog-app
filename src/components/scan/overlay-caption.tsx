import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';

/** A caption legible over any scene: bold white text on a scrim capsule. */
export function OverlayCaption({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <View style={styles.caption}>
      <ThemedText type="smallBold" themeColor="overlayText" style={styles.captionText}>{children}</ThemedText>
      {hint && <ThemedText type="small" themeColor="overlayText" style={styles.captionText}>{hint}</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  caption: {
    alignSelf: 'center', alignItems: 'center', gap: Spacing.half, maxWidth: '90%',
    backgroundColor: Colors.light.overlayScrim, borderRadius: Spacing.three, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three,
  },
  captionText: { textAlign: 'center' },
});
