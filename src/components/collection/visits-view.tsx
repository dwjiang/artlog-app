import type { ReactElement } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';

import { VisitSectionHeader } from './visit-section-header';
import { WorkLink } from './work-link';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { SavedWorkImage } from './saved-work-image';
import type { VisitSection } from '@/lib/collection/group-by-visit';

export function VisitsView({ sections, header }: { sections: VisitSection[]; header: ReactElement }) {
  return (
    <SectionList
      sections={sections}
      keyExtractor={(work) => work.localId}
      contentInsetAdjustmentBehavior="automatic"
      ListHeaderComponent={header}
      contentContainerStyle={styles.content}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => <VisitSectionHeader title={section.title} count={section.data.length} />}
      renderItem={({ item }) => (
        <WorkLink work={item} style={styles.row}>
          <SavedWorkImage path={item.cropPath} title={item.title} style={styles.thumbnail} />
          <View style={styles.text}>
            <ThemedText numberOfLines={1}>{item.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{item.artist}</ThemedText>
          </View>
        </WorkLink>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingVertical: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  thumbnail: { width: 56, height: 56, borderRadius: Spacing.two, backgroundColor: Colors.light.backgroundElement },
  text: { flex: 1 },
});
