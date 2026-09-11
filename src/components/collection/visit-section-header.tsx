import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';

export function VisitSectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.header}>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{count === 1 ? '1 work' : `${count} works`}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two, paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four, paddingBottom: Spacing.two, backgroundColor: Colors.light.background,
  },
  title: { flexShrink: 1 },
});
