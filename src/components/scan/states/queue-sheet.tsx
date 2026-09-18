import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { QueueRow } from './queue-row';
import { queueBadgeLabel } from '../queue-badge';
import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { PendingScan } from '@/db/schema';
import { retryPendingScan } from '@/lib/queue/queue';
import { useQueue } from '@/lib/queue/use-queue';
import { useLocalOwner } from '@/lib/account/owner-store';

export const QUEUE_FOOTER = 'Waiting scans are identified in order when you’re back online.';
export const QUEUE_EMPTY = 'No scans to review.';

export function queueTitle(total: number): string {
  if (total === 0) return 'Nothing is waiting';
  return queueBadgeLabel(total);
}

export function QueueSheet() {
  const owner = useLocalOwner();
  return <QueueContent key={owner} />;
}

function QueueContent() {
  const router = useRouter();
  const { items, loading, error } = useQueue();
  const pending = useRef(new Set<string>());
  const [retrying, setRetrying] = useState<string[]>([]);
  const [retryError, setRetryError] = useState<string>();

  function open(item: PendingScan) {
    router.dismiss();
    router.push({ pathname: '/result/[scanId]', params: { scanId: `local-${item.localId}` } });
  }

  function retry(item: PendingScan) {
    if (pending.current.has(item.localId)) return;
    pending.current.add(item.localId);
    setRetrying([...pending.current]);
    setRetryError(undefined);
    void retryPendingScan(item.localId)
      .catch(() => setRetryError('Couldn’t retry this scan. Your photo is still here. Tap retry again.'))
      .finally(() => {
        pending.current.delete(item.localId);
        setRetrying([...pending.current]);
      });
  }

  // The scroll view stays the root: react-native-screens sizes a form sheet's first-child scroll view to the sheet.
  return (
    <ScrollView style={styles.container} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <ThemedText type="title">{loading || error ? 'Your scans' : queueTitle(items.length)}</ThemedText>
      {loading && <View style={styles.loading} accessibilityState={{ busy: true }}><ActivityIndicator color={Colors.light.accent} /><ThemedText themeColor="textSecondary" style={{ flex: 1 }}>Loading scans…</ThemedText></View>}
      {error && <>
        <ThemedText themeColor="error" accessibilityRole="alert">Couldn’t load the scan queue. Close this sheet and reopen it to try again.</ThemedText>
        <GalleryButton label="Close queue" variant="outlined" onPress={() => router.dismiss()} />
      </>}
      {!loading && !error && items.length === 0 && <>
        <ThemedText themeColor="textSecondary">{QUEUE_EMPTY}</ThemedText>
        <GalleryButton label="Scan artwork" variant="filled" fullWidth onPress={() => { router.dismiss(); router.navigate('/(tabs)/(scan)/scan'); }} />
      </>}
      {items.map((item) => <QueueRow key={item.localId} item={item} onOpen={open} onRetry={retry} retrying={retrying.includes(item.localId)} />)}
      {retryError && <ThemedText themeColor="error" accessibilityRole="alert">{retryError}</ThemedText>}
      <ThemedText type="small" themeColor="textSecondary">{QUEUE_FOOTER}</ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  content: { padding: Spacing.content, gap: Spacing.three },
  loading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
