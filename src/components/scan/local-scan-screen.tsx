import { reportError } from '@/lib/observability';
import { ScanCropEditor } from './scan-crop-editor';
import { LoadingRing } from '@/components/loading-ring';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { isLabelCapture } from '@/lib/capture/photo-draft';
import { useLocalOwner } from '@/lib/account/owner-store';
import model from '../../../shared/model/model-version.json';

import { CaptureCompletion } from './capture-completion';
import { CaptureContextButton } from './capture-context-button';
import { CardHeader } from './result/card-header';
import { FailedCard } from './states/failed-card';
import { SaveAnywayForm } from './states/save-anyway-form';
import { WaitingForSignalCard } from './states/waiting-for-signal-card';
import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { selectPendingScan } from '@/db/repos/pending-scans';
import { useScreenActive } from '@/hooks/use-screen-active';
import { captureFileUri, scanPreviewPath } from '@/lib/files/photos';
import { retryPendingScan } from '@/lib/queue/queue';
import { useSaveResult } from '@/lib/result/use-save-result';

export const MISSING_TITLE = 'This scan isn’t on this phone anymore';

export function LocalScanScreen({ localId, manual = false }: { localId: string; manual?: boolean }) {
  const owner = useLocalOwner();
  const router = useRouter();
  const isActive = useScreenActive();
  const { data, updatedAt, error: loadError } = useLiveQuery(selectPendingScan(localId, owner), [localId, owner]);
  useEffect(() => { if (loadError) reportError(loadError, 'result.load_local_scan'); }, [loadError]);
  const row = data.find((row) => row.owner === owner);
  const labelCapture = !manual && !!row?.photoPath && isLabelCapture(row);
  const pending = row?.status === 'queued' || row?.status === 'identifying';
  const scanId = pending ? undefined : row?.scanId;
  const { saving, savedId, completion, error: saveError, save } = useSaveResult();
  const [editingCrop, setEditingCrop] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const retryPending = useRef(false);
  const keepForm = manual || hasDraft || saving || !!savedId;

  useEffect(() => {
    if (isActive && labelCapture) { router.replace({ pathname: '/label/[scanId]', params: { scanId: `local-${localId}` } }); return; }
    if (isActive && scanId && !keepForm && !editingCrop) router.replace({ pathname: '/result/[scanId]', params: { scanId } });
  }, [isActive, router, scanId, keepForm, labelCapture, localId, editingCrop]);

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
    if (retryPending.current) return;
    retryPending.current = true;
    setRetrying(true);
    setRetryError(undefined);
    void retryPendingScan(localId)
      .catch((error: unknown) => { reportError(error, 'queue.retry'); setRetryError('Couldn’t retry this scan. Your photo is still here. Try again.'); })
      .finally(() => { retryPending.current = false; setRetrying(false); });
  }

  const saveProps = {
    saving, savedId, saveError,
    captureInput: row ? { scanId: row.scanId ?? undefined, capture: row } : undefined,
    onSave: (draft: Parameters<typeof save>[0]['draft']) => { void save({ scanId: row?.scanId ?? undefined, capture: row, draft }); },
    onViewSaved: () => router.push({ pathname: '/saved/[savedId]', params: { savedId: savedId ?? '' } }),
    onDraftChange: setHasDraft,
  };

  if (editingCrop && row) return <ScanCropEditor capture={row} onCancel={() => setEditingCrop(false)} />;
  if (labelCapture) return <ThemedView style={styles.container}><LoadingRing accessibilityLabel="Opening your label…" style={{ flex: 1 }} /></ThemedView>;
  if (completion) return <CaptureCompletion completion={completion} onViewResult={scanId ? openResult : undefined} />;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        contentContainerStyle={styles.content}
      >
        {row && <CardHeader cropUri={captureFileUri(scanPreviewPath(row.cropPath))} inputSize={model.inputSize} kind={row.status === 'failed' ? 'failed' : 'loading'} />}
        {row && !savedId && <GalleryButton label="Adjust crop" icon="crop" disabled={saving} onPress={() => {
          if (hasDraft) Alert.alert('Adjust this crop?', 'Recognition will run again. Unsaved artwork details will be discarded.', [
            { text: 'Keep editing', style: 'cancel' }, { text: 'Adjust crop', onPress: () => { setHasDraft(false); setEditingCrop(true); } },
          ]);
          else setEditingCrop(true);
        }} />}
        {row && !savedId && <CaptureContextButton capture={row} disabled={saving} />}
        {loadError ? <ThemedText themeColor="error" accessibilityRole="alert">Couldn’t load this scan. Close this screen and reopen it to try again.</ThemedText>
          : !updatedAt ? <View style={styles.loading} accessibilityState={{ busy: true }}><LoadingRing color={Colors.light.accent} accessibilityLabel="Loading your scan…" /></View>
          : !row ? <View style={styles.section}><ThemedText type="subtitle">{MISSING_TITLE}</ThemedText><GalleryButton label="Scan another artwork" variant="filled" fullWidth onPress={() => { router.dismissAll(); router.navigate('/(tabs)/(scan)/scan'); }} /></View>
          : scanId ? keepForm && (
            <View style={styles.section}>
              <ThemedText type="subtitle">Your result is ready</ThemedText>
              <GalleryButton label="View result" variant="filled" fullWidth disabled={saving} onPress={openResult} />
            </View>
          )
          : row.status === 'failed' ? <FailedCard error={row.lastError} onRetry={retry} retrying={retrying} />
          : row.status === 'identified' ? null
          : <WaitingForSignalCard status={row.status} onLabel={openLabel} />}
        {retryError && <ThemedText themeColor="error" accessibilityRole="alert">{retryError}</ThemedText>}
        {row && (pending || row.status === 'failed' || keepForm) && <SaveAnywayForm {...saveProps} initiallyEditing={manual} />}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: Spacing.four },
  section: { gap: Spacing.two },
  loading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
