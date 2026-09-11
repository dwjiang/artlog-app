import { Button, Host } from '@expo/ui';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import model from '../../../shared/model-version.json';

import { CardHeader } from './result/card-header';
import { FailedCard } from './states/failed-card';
import { SaveAnywayForm } from './states/save-anyway-form';
import { WaitingForSignalCard } from './states/waiting-for-signal-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { selectPendingScan } from '@/db/repos/pending-scans';
import { useScreenActive } from '@/hooks/use-screen-active';
import { captureFileUri } from '@/lib/files/photos';
import { retryPendingScan } from '@/lib/queue/queue';
import { useSaveResult } from '@/lib/result/use-save-result';

export const MISSING_TITLE = 'This scan isn’t on this phone anymore';

export function LocalScanScreen({ localId }: { localId: string }) {
  const router = useRouter();
  const isActive = useScreenActive();
  const { data, updatedAt } = useLiveQuery(selectPendingScan(localId), [localId]);
  const row = data[0];
  const pending = row?.status === 'queued' || row?.status === 'identifying';
  const scanId = pending ? undefined : row?.scanId;
  const { saving, savedId, error: saveError, save } = useSaveResult();
  const [hasDraft, setHasDraft] = useState(false);
  const keepForm = hasDraft || saving || !!savedId;

  useEffect(() => {
    if (isActive && scanId && !keepForm) router.replace({ pathname: '/result/[scanId]', params: { scanId } });
  }, [isActive, router, scanId, keepForm]);

  function openResult() {
    if (!scanId || saving) return;
    const open = () => router.replace({ pathname: '/result/[scanId]', params: { scanId } });
    if (hasDraft && !savedId) {
      Alert.alert('Discard your edits?', 'Save your entry first to keep these details, or discard them to view the result.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard edits', style: 'destructive', onPress: open },
      ]);
    } else {
      open();
    }
  }

  function openLabel() {
    router.push({ pathname: '/label/[scanId]', params: { scanId: `local-${localId}`, offline: '1' } });
  }

  function retry() {
    void retryPendingScan(localId).catch((cause: unknown) => console.warn('Could not retry the scan', cause));
  }

  const saveProps = {
    saving, savedId, saveError,
    onSave: (draft: Parameters<typeof save>[0]['draft']) => { void save({ scanId: row?.scanId ?? undefined, capture: row, draft }); },
    onViewSaved: () => router.push({ pathname: '/(tabs)/(collection)/[savedId]', params: { savedId: savedId ?? '' } }),
    onDraftChange: setHasDraft,
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        contentContainerStyle={styles.content}
      >
        <CardHeader cropUri={row ? captureFileUri(row.cropPath) : undefined} inputSize={model.inputSize} kind={row?.status === 'failed' ? 'failed' : 'loading'} />
        {!updatedAt ? null
          : !row ? <View style={styles.section}><ThemedText type="subtitle">{MISSING_TITLE}</ThemedText></View>
          : scanId ? keepForm && (
            <View style={styles.section}>
              <ThemedText type="subtitle">Your result is ready</ThemedText>
              <Host matchContents colorScheme="light">
                <Button label="View result" disabled={saving} onPress={openResult} />
              </Host>
            </View>
          )
          : row.status === 'failed' ? <FailedCard error={row.lastError} onRetry={retry} />
          : row.status === 'identified' ? null
          : <WaitingForSignalCard status={row.status} onLabel={openLabel} />}
        {row && (pending || keepForm) && <SaveAnywayForm {...saveProps} />}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four },
  section: { gap: Spacing.two },
});
