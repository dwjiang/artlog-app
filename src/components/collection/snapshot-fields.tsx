import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { SavedWork } from '@/db/schema';
import { formatDay } from '@/lib/collection/format-day';

// Read-only by design: a saved work is what the user saw, where and when.
export function SnapshotFields({ work }: { work: SavedWork }) {
  const rows: [string, string | null][] = [['Date', work.date], ['Medium', work.medium], ['Institution', work.institution]];
  const seen = [work.venueName, formatDay(work.savedAt), work.gallery].filter(Boolean).join(' · ');
  return (
    <View style={styles.fields}>
      <ThemedText type="subtitle">{work.title}</ThemedText>
      <ThemedText>{work.artist}</ThemedText>
      {rows.map(([label, value]) => value ? (
        <View key={label} style={styles.row}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.label}>{label}</ThemedText>
          <ThemedText style={styles.value}>{value}</ThemedText>
        </View>
      ) : null)}
      <ThemedText type="small" themeColor="textSecondary">
        {work.venueName ? `Seen at ${seen}` : `Saved ${formatDay(work.savedAt)}`}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.three },
  label: { width: 88, lineHeight: 24 },
  value: { flex: 1 },
});
