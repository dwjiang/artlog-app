import type { ReactElement } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { WorkLink } from './work-link';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { SavedWork } from '@/db/schema';
import { SavedWorkImage } from './saved-work-image';

export function GridView({ works, header }: { works: SavedWork[]; header: ReactElement }) {
  return (
    <FlatList
      data={works}
      numColumns={3}
      keyExtractor={(work) => work.localId}
      contentInsetAdjustmentBehavior="automatic"
      ListHeaderComponent={header}
      contentContainerStyle={styles.content}
      columnWrapperStyle={styles.row}
      renderItem={({ item }) => (
        <WorkLink work={item} style={styles.cell}>
          <SavedWorkImage path={item.cropPath} title={item.title} style={styles.thumbnail} />
          <ThemedText type="small" numberOfLines={1}>{item.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{item.artist}</ThemedText>
        </WorkLink>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, gap: Spacing.three },
  row: { gap: Spacing.three },
  // A third of the row so a short last row keeps the cell size.
  cell: { flex: 1 / 3, gap: Spacing.one },
  thumbnail: { width: '100%', aspectRatio: 1, borderRadius: Spacing.two, backgroundColor: Colors.light.backgroundElement },
});
