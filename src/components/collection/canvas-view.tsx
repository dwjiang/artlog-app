import type { ReactElement } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { WorkLink } from './work-link';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { SavedWork } from '@/db/schema';
import { SavedWorkImage } from './saved-work-image';

const CANVAS_SIZE = 220;

/** A wall to walk along: crops are letterboxed squares, so every frame hangs at the same size. */
export function CanvasView({ works, header }: { works: SavedWork[]; header: ReactElement }) {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      {header}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.wall} contentContainerStyle={styles.wallContent}>
        {works.map((work) => (
          <WorkLink key={work.localId} work={work} style={styles.hanging}>
            <View style={styles.frame}>
              <SavedWorkImage path={work.cropPath} title={work.title} style={styles.canvas} />
            </View>
            <View style={styles.plaque}>
              <ThemedText type="smallBold" numberOfLines={1}>{work.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{work.artist}</ThemedText>
            </View>
          </WorkLink>
        ))}
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingVertical: Spacing.three },
  wall: { backgroundColor: Colors.light.backgroundElement },
  wallContent: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.six, gap: Spacing.five },
  hanging: { alignItems: 'center', gap: Spacing.three },
  frame: {
    padding: Spacing.two, backgroundColor: Colors.light.background, borderWidth: 1,
    borderColor: Colors.light.backgroundSelected, boxShadow: '0 8px 20px rgba(0, 0, 0, 0.18)',
  },
  canvas: { width: CANVAS_SIZE, height: CANVAS_SIZE },
  plaque: {
    width: CANVAS_SIZE * 0.7, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one,
    backgroundColor: Colors.light.background, borderRadius: Spacing.half,
  },
});
