import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { PendingScan, PendingScanStatus } from '@/db/schema';
import { captureFileUri } from '@/lib/files/photos';
import { formatRelativeTime } from '@/lib/queue/relative-time';

export const RETRY_ROW = 'Failed — tap to retry';

export function queueStatusText(status: PendingScanStatus): string {
  switch (status) {
    case 'queued': return 'Waiting for signal';
    case 'identifying': return 'Identifying…';
    case 'failed': return RETRY_ROW;
    case 'identified': return 'Ready to review';
  }
}

export type QueueRowProps = {
  item: PendingScan;
  now?: number;
  onOpen: (item: PendingScan) => void;
  onRetry: (item: PendingScan) => void;
};

export function QueueRow({ item, now, onOpen, onRetry }: QueueRowProps) {
  const when = formatRelativeTime(item.capturedAt, now);
  const status = queueStatusText(item.status);
  const hasLabel = Boolean(item.labelPhotoPath || item.qrUrl);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Scan from ${when}, ${status}`}
      onPress={() => onOpen(item)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Image source={captureFileUri(item.cropPath)} contentFit="cover" style={styles.thumbnail} />
      <View style={styles.text}>
        <ThemedText numberOfLines={1}>{when}</ThemedText>
        {item.status === 'failed' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={RETRY_ROW} onPress={() => onRetry(item)} hitSlop={Spacing.two}>
            <ThemedText type="small" themeColor="accent">{RETRY_ROW}</ThemedText>
          </Pressable>
        ) : (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{status}</ThemedText>
        )}
      </View>
      {hasLabel && (
        <Image source="sf:tag" accessibilityLabel="Label attached" style={styles.labelIcon} tintColor={Colors.light.textSecondary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.two, borderRadius: Spacing.three, backgroundColor: Colors.light.backgroundElement },
  pressed: { opacity: 0.6 },
  thumbnail: { width: 56, height: 56, borderRadius: Spacing.two, backgroundColor: Colors.light.backgroundSelected },
  text: { flex: 1, gap: Spacing.half },
  labelIcon: { width: 20, height: 20 },
});
