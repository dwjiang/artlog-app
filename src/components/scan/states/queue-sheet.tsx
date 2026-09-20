import { EmptyState, EmptySymbol } from '@/components/empty-state';
import { ListSkeleton } from '@/components/loading-skeleton';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { QueueRow } from './queue-row';
import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { PendingScan } from '@/db/schema';
import { retryPendingScan } from '@/lib/queue/queue';
import { useQueue } from '@/lib/queue/use-queue';
import { useLocalOwner } from '@/lib/account/owner-store';
import { discardCapture } from '@/lib/capture/discard-capture';

export const QUEUE_FOOTER = 'Waiting scans continue when you’re back online.';
export const QUEUE_EMPTY = 'Scan an artwork or its wall label. Your recent scans will appear here.';

export function QueueSheet() {
  const owner = useLocalOwner();
  return <QueueContent key={owner} />;
}

function QueueContent() {
  const owner = useLocalOwner();
  const router = useRouter();
  const { items, loading, error } = useQueue();
  const pending = useRef(new Set<string>());
  const [retrying, setRetrying] = useState<string[]>([]);
  const [retryError, setRetryError] = useState<string>();
  const [discarding, setDiscarding] = useState<string[]>([]);
  const [discardError, setDiscardError] = useState<string>();

  function discard(item: PendingScan) {
    Alert.alert('Discard this scan?', 'Its unsaved photos will be removed from this device.', [
      { text: 'Keep scan', style: 'cancel' },
      { text: 'Discard scan', style: 'destructive', onPress: () => {
        if (pending.current.has(item.localId)) return;
        pending.current.add(item.localId);
        setDiscarding((ids) => [...ids, item.localId]);
        setDiscardError(undefined);
        void discardCapture(item.localId, owner)
          .catch(() => setDiscardError('Couldn’t finish removing this scan. Try again.'))
          .finally(() => {
            pending.current.delete(item.localId);
            setDiscarding((ids) => ids.filter((id) => id !== item.localId));
          });
      } },
    ]);
  }

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
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>Recent scans</ThemedText>
        <GalleryButton label="Close" onPress={() => router.dismiss()} />
      </View>
      {!error && (loading || items.length > 0) && <ThemedText themeColor="textSecondary">Your photos stay here until you save or discard.</ThemedText>}
      {loading && !error && !items.length && <ListSkeleton label="Loading scans…" rows={3} />}
      {error && <>
        <ThemedText themeColor="error" accessibilityRole="alert">Couldn’t load recent scans. Close this sheet and reopen it to try again.</ThemedText>
      </>}
      {!loading && !error && items.length === 0 && <EmptyState inset={false} title="A fresh pair of eyes." detail={QUEUE_EMPTY} visual={<EmptySymbol name="camera" />}>
        <GalleryButton label="Scan artwork" variant="filled" fullWidth onPress={() => { router.dismiss(); router.navigate('/(tabs)/(scan)/scan'); }} />
      </EmptyState>}
      {items.map((item) => <QueueRow key={item.localId} item={item} onOpen={open} onRetry={retry} onDiscard={discard} retrying={retrying.includes(item.localId)} discarding={discarding.includes(item.localId)} />)}
      {retryError && <ThemedText themeColor="error" accessibilityRole="alert">{retryError}</ThemedText>}
      {discardError && <ThemedText themeColor="error" accessibilityRole="alert">{discardError}</ThemedText>}
      {items.some((item) => item.status === 'queued' || item.status === 'identifying') && <ThemedText type="small" themeColor="textSecondary">{QUEUE_FOOTER}</ThemedText>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  content: { padding: Spacing.content, gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  title: { flex: 1 },
});
