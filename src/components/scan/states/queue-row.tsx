import { LoadingRing } from '@/components/loading-ring';
import { Host, Icon } from '@expo/ui';
import { Button, Menu } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, contentShape, disabled, frame, shapes } from '@expo/ui/swift-ui/modifiers';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Gallery, Spacing } from '@/constants/theme';
import type { PendingScan, PendingScanStatus } from '@/db/schema';
import { captureFileUri, scanPreviewPath } from '@/lib/files/photos';
import { formatRelativeTime } from '@/lib/queue/relative-time';
import { readPhotoSession } from '@/lib/capture/photo-draft';

export const RETRY_ROW = 'Retry scan';

export function queueStatusText(status: PendingScanStatus): string {
  switch (status) {
    case 'queued': return 'Waiting for signal';
    case 'identifying': return 'Identifying…';
    case 'failed': return 'Couldn’t identify';
    case 'identified': return 'Ready to save';
  }
}

export type QueueRowProps = {
  item: PendingScan;
  now?: number;
  onOpen: (item: PendingScan) => void;
  onRetry: (item: PendingScan) => void;
  retrying?: boolean;
  onDiscard: (item: PendingScan) => void;
  discarding?: boolean;
};

export function QueueRow({ item, now, onOpen, onRetry, onDiscard, retrying = false, discarding = false }: QueueRowProps) {
  const when = formatRelativeTime(item.capturedAt, now);
  const status = queueStatusText(item.status);
  const hasLabel = Boolean(item.labelPhotoPath || item.qrUrl);
  const session = readPhotoSession(item.owner, item.photoPath);
  const title = session.saveInput?.draft.title.trim() || 'Artwork scan';
  const photoCount = session.photos.length + 1;
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Scan from ${when}, ${status}`}
        onPress={() => onOpen(item)}
        disabled={discarding}
        accessibilityState={{ disabled: discarding, busy: discarding }}
        style={({ pressed }) => [styles.capture, pressed && styles.pressed]}
      >
        <Image source={captureFileUri(scanPreviewPath(item.cropPath))} contentFit="cover" style={styles.thumbnail} />
        <View style={styles.text}>
          <ThemedText type="smallBold" numberOfLines={2}>{title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{when} · {photoCount} {photoCount === 1 ? 'photo' : 'photos'}</ThemedText>
          {retrying || item.status === 'identifying' || discarding ? <LoadingRing accessibilityLabel={discarding ? 'Discarding scan…' : retrying ? 'Retrying…' : status} style={{ alignSelf: 'flex-start' }} />
            : <ThemedText type="small" themeColor={item.status === 'failed' ? 'error' : item.status === 'identified' ? 'success' : 'warning'}>{status}</ThemedText>}
        </View>
        {hasLabel && (
          <Image source="sf:tag" accessibilityLabel="Label attached" style={styles.labelIcon} tintColor={Colors.light.textSecondary} />
        )}
      </Pressable>
      <Host matchContents colorScheme="light">
        <Menu label={<Icon name="ellipsis" size={20} color={Gallery.muted} modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.rectangle())]} />}
          modifiers={[accessibilityLabel(`Options for scan from ${when}`), buttonStyle('plain'), disabled(discarding || retrying)]}>
          <Button label="Resume" systemImage="arrow.right" onPress={() => onOpen(item)} />
          {item.status === 'failed' && <Button label={RETRY_ROW} systemImage="arrow.clockwise" modifiers={[disabled(retrying || discarding)]} onPress={() => onRetry(item)} />}
          <Button label="Discard scan" systemImage="trash" role="destructive" onPress={() => onDiscard(item)} />
        </Menu>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Gallery.separator },
  capture: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  pressed: { opacity: 0.6 },
  thumbnail: { width: 64, height: 76, borderRadius: 2, backgroundColor: Colors.light.backgroundElement },
  text: { flex: 1, gap: Spacing.half },
  labelIcon: { width: 20, height: 20 },
});
