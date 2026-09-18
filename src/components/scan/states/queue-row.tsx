import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Gallery, Spacing } from '@/constants/theme';
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
  retrying?: boolean;
};

export function QueueRow({ item, now, onOpen, onRetry, retrying = false }: QueueRowProps) {
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
        <ThemedText>{when}</ThemedText>
        {item.status === 'failed' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={retrying ? 'Retrying scan…' : RETRY_ROW} accessibilityState={{ disabled: retrying, busy: retrying }} disabled={retrying} onPress={() => onRetry(item)} style={styles.retry}>
            <ThemedText type="small" themeColor="error">{retrying ? 'Retrying…' : RETRY_ROW}</ThemedText>
          </Pressable>
        ) : (
          <ThemedText type="small" themeColor={item.status === 'identified' ? 'success' : item.status === 'queued' ? 'warning' : 'textSecondary'}>{status}</ThemedText>
        )}
      </View>
      {hasLabel && (
        <Image source="sf:tag" accessibilityLabel="Label attached" style={styles.labelIcon} tintColor={Colors.light.textSecondary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  pressed: { opacity: 0.6 },
  thumbnail: { width: 56, height: 56, borderRadius: 2, backgroundColor: Colors.light.backgroundElement },
  text: { flex: 1, gap: Spacing.half },
  labelIcon: { width: 20, height: 20 },
  retry: { minHeight: 44, justifyContent: 'center' },
});
