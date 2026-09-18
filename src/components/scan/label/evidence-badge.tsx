import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { badgeFor, EDITED_LABEL, type FieldState } from '@/lib/label/fields';

/** Where a field's value came from: a locked source, or "Edited by you" once the user touched it. */
export function EvidenceBadge({ field }: { field: FieldState }) {
  const label = badgeFor(field);
  if (!label) return null;
  const verified = label !== EDITED_LABEL;
  return (
    <View style={styles.badge} accessibilityLabel={label}>
      {verified && <Image source="sf:lock.fill" tintColor={Colors.light.textSecondary} style={styles.lock} />}
      <ThemedText type="small" themeColor="textSecondary" style={{ flexShrink: 1 }}>{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'flex-start', flexShrink: 1, gap: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.half,
    borderRadius: 2, backgroundColor: Colors.light.backgroundElement,
  },
  lock: { width: 12, height: 12 },
});
