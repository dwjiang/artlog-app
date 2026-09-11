import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import { GlassSurface } from '@/components/glass-surface';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useQueue } from '@/lib/queue/use-queue';

export function queueBadgeLabel(pending: number): string {
  return pending === 1 ? '1 scan waiting for signal' : `${pending} scans waiting for signal`;
}

/** Counts captures still waiting for signal; plan 05.05 makes it open the queue sheet. */
export function QueueBadge() {
  const { pending } = useQueue();
  if (pending === 0) return null;
  return (
    <GlassSurface style={styles.badge} accessible accessibilityRole="text" accessibilityLabel={queueBadgeLabel(pending)}>
      <Image source="sf:tray.and.arrow.up" style={styles.icon} tintColor={Colors.light.overlayText} />
      <ThemedText type="smallBold" themeColor="overlayText">{String(pending)}</ThemedText>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: Spacing.four, overflow: 'hidden',
    paddingVertical: Spacing.two + Spacing.half, paddingHorizontal: Spacing.three,
  },
  icon: { width: 18, height: 18 },
});
