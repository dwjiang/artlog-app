import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { QueueRow } from './queue-row';
import { queueBadgeLabel } from '../queue-badge';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { PendingScan } from '@/db/schema';
import { retryPendingScan } from '@/lib/queue/queue';
import { useQueue } from '@/lib/queue/use-queue';

export const QUEUE_FOOTER = 'Waiting scans are identified in order when you’re back online.';
export const QUEUE_EMPTY = 'No scans to review.';

export function queueTitle(total: number): string {
  if (total === 0) return 'Nothing is waiting';
  return queueBadgeLabel(total);
}

export function QueueSheet() {
  const router = useRouter();
  const { items } = useQueue();

  function open(item: PendingScan) {
    router.dismiss();
    router.push({ pathname: '/result/[scanId]', params: { scanId: `local-${item.localId}` } });
  }

  function retry(item: PendingScan) {
    void retryPendingScan(item.localId).catch((error: unknown) => console.warn('Could not retry the scan', error));
  }

  // The scroll view stays the root: react-native-screens sizes a form sheet's first-child scroll view to the sheet.
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ThemedText type="subtitle">{queueTitle(items.length)}</ThemedText>
      {items.length === 0 && <ThemedText themeColor="textSecondary">{QUEUE_EMPTY}</ThemedText>}
      {items.map((item) => <QueueRow key={item.localId} item={item} onOpen={open} onRetry={retry} />)}
      <ThemedText type="small" themeColor="textSecondary">{QUEUE_FOOTER}</ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  content: { padding: Spacing.four, gap: Spacing.three },
});
