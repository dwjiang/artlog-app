import { LoadingRing } from '@/components/loading-ring';
import { FormSkeleton } from '@/components/loading-skeleton';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useNetworkState } from 'expo-network';
import { useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, usePhotoOutput } from 'react-native-vision-camera';

import { useLocalOwner } from '@/lib/account/owner-store';
import type { Id } from '../../../convex/_generated/dataModel';
import type { LabelFieldName, LabelFlowDisplay } from '../../../convex/lib/validators';

import { isLabelCapture } from '@/lib/capture/photo-draft';
import { CapturePhotosButton } from './capture-photos-button';
import { CaptureContextButton } from './capture-context-button';
import { CameraPermission } from './camera-permission';
import { LabelActions } from './label/label-actions';
import { LabelViewfinder } from './label/label-viewfinder';
import { ProgressSteps } from './label/progress-steps';
import { VerifiedFieldsForm } from './label/verified-fields-form';
import { SourceChip } from './result/source-chip';
import { OverlayCaption } from './overlay-caption';
import { GalleryButton } from '@/components/collection/gallery-button';
import { GlassSurface } from '@/components/glass-surface';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Colors, Spacing } from '@/constants/theme';
import { MAX_LABEL_ATTEMPTS, setLabelPhoto, setQrUrl } from '@/db/repos/pending-scans';
import { useQrScanner } from '@/lib/capture/use-qr-scanner';
import { persistLabelPhoto } from '@/lib/files/photos';
import { removeFile } from '@/lib/label/crop';
import { canSaveLabel, canShareLabel, setFieldValue, unlockField } from '@/lib/label/fields';
import { LabelFlowError, type LabelStage } from '@/lib/label/flow';
import { runLabelFlowForScan, type LabelSource } from '@/lib/label/label-deps';
import { useLabelCapture } from '@/lib/label/use-label-capture';
import { useLabelForm } from '@/lib/label/use-label-form';
import { isTransientError } from '@/lib/network-error';
import { discardPendingLabel, flushQueue, retryPendingLabel } from '@/lib/queue/queue';
import { useSaveResult } from '@/lib/result/use-save-result';
import type { ResultViewState } from '@/lib/result/state';
import { useScan } from '@/lib/result/use-scan';

export const LABEL_PROMPT = 'Not in our index yet — point at the label';
export const QR_FOUND = 'Found a QR code';
export const QUEUED_MESSAGE = 'Saved — we’ll finish this when you’re back online';
export const QUEUED_ONLINE_MESSAGE = 'Saved — we’ll finish this label shortly';
const MISSING_CAPTURE = 'Your photo of this scan isn’t on this phone, so the label can’t be kept with it.';
// Label saves never count as confirms of a match: the view carries no primary work, so `suggested` is null.
const LABEL_VIEW: ResultViewState = { kind: 'unidentified', runnerUps: [], editable: true };
const SHUTTER_SIZE = 72;
const SHUTTER_RING = 4;
const SHUTTER_GAP = 3;
const IMPORT_SIZE = 56;

export type LabelCaptureScreenProps = {
  scanId: string;
  intent?: 'capture' | 'review';
};

type Phase =
  | { kind: 'capture'; restore?: boolean }
  | { kind: 'running'; stage: LabelStage; qr: boolean }
  | { kind: 'review'; flow: LabelFlowDisplay }
  | { kind: 'queued' }
  | { kind: 'error'; message: string };

export function LabelCaptureScreen({ scanId, intent = 'review' }: LabelCaptureScreenProps) {
  const owner = useLocalOwner();
  // The router reuses this screen for a new scan id; the key drops the previous label's phase and form.
  return <LabelCapture key={`${owner}:${scanId}:${intent}`} scanId={scanId} intent={intent} />;
}

function LabelCapture({ scanId, intent }: LabelCaptureScreenProps) {
  const router = useRouter();
  const isFocused = useIsFocused();
  const network = useNetworkState();
  const { top, bottom } = useSafeAreaInsets();
  const [appState, setAppState] = useState(AppState.currentState);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  const [phase, setPhase] = useState<Phase>({ kind: 'capture', restore: intent !== 'capture' });
  const [busy, setBusy] = useState(false);
  const capture = useLabelCapture(scanId);
  const labelOnly = !!capture && isLabelCapture(capture);
  const { saving, savedId, completion, error: saveError, save, sharing, shared, shareError, retrySharing } = useSaveResult();
  const mounted = useRef(true);
  const inFlight = useRef(false);

  // Queued captures carry a local id until identified: their label waits on the row for the queue.
  const localId = scanId.startsWith('local-') ? scanId.slice('local-'.length) : undefined;
  const remoteScanId = localId ? capture?.scanId ?? undefined : scanId as Id<'scans'>;
  const scan = useScan(remoteScanId);
  const storedFlow = scan && !(scan instanceof Error) ? scan.labelFlow : undefined;
  const { form, setForm, error: formError, retry: retryForm } = useLabelForm(remoteScanId, phase.kind === 'review' ? phase.flow : undefined);
  const pendingLabel = !!(capture?.labelPhotoPath || capture?.qrUrl);
  const storeOnly = !remoteScanId || network.isInternetReachable === false;
  const restoring = !!remoteScanId && !storeOnly && scan === undefined;
  const active = isFocused && appState === 'active' && phase.kind === 'capture' && !restoring && !pendingLabel;
  const photoOutput = usePhotoOutput({ containerFormat: 'jpeg', quality: 1 });

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', setAppState);
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);

  if (phase.kind === 'queued' || phase.kind === 'capture') {
    if (pendingLabel) {
      if (phase.kind === 'capture') setPhase({ kind: 'queued' });
    } else if ((phase.kind === 'queued' || phase.restore !== false) && storedFlow?.stage === 'verified' && storedFlow.moderation === 'clear') {
      setPhase({ kind: 'review', flow: storedFlow });
    }
  }

  async function queueLabel(label: { photoUri?: string; qrUrl?: string }) {
    if (!capture) {
      if (mounted.current) setPhase({ kind: 'error', message: MISSING_CAPTURE });
      return;
    }
    if (label.photoUri) await setLabelPhoto(capture.localId, await persistLabelPhoto({ localId: capture.localId, photoUri: label.photoUri }), capture.owner);
    if (label.qrUrl) await setQrUrl(capture.localId, label.qrUrl, capture.owner);
    if (mounted.current) setPhase({ kind: 'queued' });
    void flushQueue();
  }

  async function runFlow(source: LabelSource) {
    if (!remoteScanId) return;
    const qr = !!source.qrUrl;
    let keepSource = false;
    setPhase({ kind: 'running', stage: qr ? 'qr' : 'read', qr });
    try {
      const flow = await runLabelFlowForScan(remoteScanId, source, (stage) => {
        if (mounted.current) setPhase((current) => current.kind === 'running' ? { ...current, stage } : current);
      });
      if (!mounted.current) return;
      setPhase({ kind: 'review', flow });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (error) {
      console.warn('Label flow failed', error);
      if (isTransientError(error instanceof LabelFlowError ? error.cause ?? error : error)) {
        keepSource = true;
        await queueLabel({ photoUri: source.labelPhotoUri, qrUrl: source.qrUrl });
        return;
      }
      if (mounted.current) setPhase({ kind: 'error', message: error instanceof LabelFlowError ? error.message : 'Couldn’t verify the label right now' });
    } finally {
      if (!keepSource && source.labelPhotoUri) removeFile(source.labelPhotoUri);
    }
  }

  async function handleLabel(getLabel: () => Promise<{ photoUri?: string; qrUrl?: string } | null>, failureMessage?: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const label = await getLabel();
      if (!label) return;
      if (!mounted.current) {
        if (label.photoUri) removeFile(label.photoUri);
        return;
      }
      if (storeOnly) await queueLabel(label);
      else await runFlow({ labelPhotoUri: label.photoUri, qrUrl: label.qrUrl });
    } catch (error) {
      console.warn('Could not keep the label', error);
      if (mounted.current) setPhase({ kind: 'error', message: failureMessage ?? (error instanceof Error ? error.message : 'Couldn’t keep the label. Try again.') });
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  // The scanner keeps one stable callback; the ref hands it the latest capture and reachability.
  const latestHandleLabel = useRef(handleLabel);
  useEffect(() => { latestHandleLabel.current = handleLabel; });
  const onCode = useCallback((url: string) => { void latestHandleLabel.current(async () => ({ qrUrl: url })); }, []);
  const qrOutput = useQrScanner(active && !busy, onCode);
  const outputs = useMemo(() => qrOutput ? [photoOutput, qrOutput] : [photoOutput], [photoOutput, qrOutput]);

  function takePhoto() {
    if (!active || !cameraReady || busy) return;
    void Haptics.selectionAsync().catch(() => {});
    void handleLabel(async () => {
      const { filePath } = await photoOutput.capturePhotoToFile({}, {});
      return { photoUri: `file://${filePath}` };
    }, 'Couldn’t take the photo. Try again.');
  }

  function importPhoto() {
    if (busy) return;
    void handleLabel(async () => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Allow photo access in Settings to import a label photo.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (result.canceled || !result.assets[0]) return null;
      return { photoUri: result.assets[0].uri };
    });
  }

  async function retakeLabel() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (capture) await discardPendingLabel(capture.localId);
      if (mounted.current) setPhase({ kind: 'capture', restore: false });
    } catch (error) {
      console.warn('Could not discard the pending label', error);
      if (mounted.current) setPhase({ kind: 'error', message: 'Couldn’t replace the label. Try again.' });
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function retryLabel() {
    if (!capture || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await retryPendingLabel(capture.localId);
    } catch {
      if (mounted.current) setPhase({ kind: 'error', message: 'Couldn’t retry this label. Your scan and label are still on this phone.' });
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function onChange(name: LabelFieldName, value: string) {
    setForm((current) => current && setFieldValue(current, name, value));
  }

  function onUnlock(name: LabelFieldName) {
    setForm((current) => current && unlockField(current, name));
  }

  if (phase.kind === 'running') {
    return (
      <ThemedView style={styles.container}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} accessibilityState={{ busy: true }}>
          <ThemedText type="subtitle">{phase.qr ? QR_FOUND : 'Reading the label'}</ThemedText>
          <ProgressSteps stage={phase.stage} qr={phase.qr} />
        </ScrollView>
      </ThemedView>
    );
  }

  if (phase.kind === 'queued') {
    if (!pendingLabel && storedFlow?.moderation === 'flagged') {
      return (
        <StateCard title={new LabelFlowError('label_flagged').message}>
          <GalleryButton label="Retake label" variant="filled" fullWidth disabled={busy} onPress={() => { void retakeLabel(); }} />
        </StateCard>
      );
    }
    if (!pendingLabel && scan && !(scan instanceof Error) && scan.outcome === 'confident') {
      return (
        <StateCard title="Painting identified">
          <GalleryButton label="View result" variant="filled" fullWidth onPress={() => router.replace({ pathname: '/result/[scanId]', params: { scanId: scan.scanId } })} />
        </StateCard>
      );
    }
    if (capture && capture.lastError && capture.attempts >= MAX_LABEL_ATTEMPTS) {
      return (
        <StateCard title={new LabelFlowError(capture.lastError).message}>
          <GalleryButton label="Try again" variant="filled" fullWidth disabled={busy} busy={busy} onPress={() => { void retryLabel(); }} />
          <GalleryButton label="Retake label" variant="outlined" fullWidth disabled={busy} onPress={() => { void retakeLabel(); }} />
        </StateCard>
      );
    }
    return (
      <StateCard title={network.isInternetReachable === false ? QUEUED_MESSAGE : QUEUED_ONLINE_MESSAGE} detail="Your scan and this label are queued together; we’ll identify and read them in order.">
        <GalleryButton label="Back to the scan" variant="filled" fullWidth onPress={() => router.back()} />
      </StateCard>
    );
  }

  if (phase.kind === 'capture' && restoring) return <StateCard><FormSkeleton label="Loading the label…" /></StateCard>;

  if (phase.kind === 'capture' && phase.restore !== false && scan instanceof Error && !storeOnly) {
    return <StateCard title="Couldn’t load this label" detail="Your captured photo stays on this phone. Capture the label again to continue.">
      <GalleryButton label="Capture label" variant="filled" fullWidth onPress={() => setPhase({ kind: 'capture', restore: false })} />
    </StateCard>;
  }

  if (phase.kind === 'error') {
    return (
      <StateCard title={phase.message}>
        <GalleryButton label="Try again" variant="filled" fullWidth onPress={() => setPhase({ kind: 'capture', restore: false })} />
      </StateCard>
    );
  }

  if (phase.kind === 'review' && !form) {
    return (
      <StateCard title={formError?.message}>
        {!formError && <FormSkeleton label="Loading the label…" />}
        {formError && <GalleryButton label="Try again" variant="filled" fullWidth onPress={retryForm} />}
      </StateCard>
    );
  }

  if (phase.kind === 'review' && form) {
    const editable = !saving && !sharing && !savedId;
    const contribution = capture && capture.venueId && remoteScanId && !labelOnly && canShareLabel(form)
      ? { scanId: remoteScanId, capture, state: form } : undefined;
    const input = { scanId: remoteScanId, capture, view: LABEL_VIEW, contribution,
      draft: { title: form.title.value, artist: form.artist.value, date: form.date.value, medium: form.medium.value, institution: '' } };
    return (
      <ThemedView style={styles.container}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
          contentContainerStyle={styles.content}
        >
          <ThemedText type="subtitle">From the label</ThemedText>
          {phase.flow.sourceUrl && <SourceChip label="Museum page" url={phase.flow.sourceUrl} />}
          <VerifiedFieldsForm key={phase.flow.updatedAt} state={form} warnings={phase.flow.warnings} editable={editable} onChange={onChange} onUnlock={onUnlock} />
          {capture && !savedId && <>
            <CaptureContextButton capture={capture} disabled={saving} />
            <CapturePhotosButton disabled={saving} input={{ ...input, capture }} />
          </>}
          <LabelActions
            allowContribution={!!contribution}
            canSave={canSaveLabel(form)}
            saving={saving}
            sharing={sharing}
            savedId={savedId}
            completion={completion}
            shared={shared}
            saveError={saveError}
            shareError={shareError}
            onSave={() => { void save(input); }}
            onShare={() => { void retrySharing(); }}
            onViewSaved={() => router.push({ pathname: '/saved/[savedId]', params: { savedId: savedId ?? '' } })}
          />
        </ScrollView>
      </ThemedView>
    );
  }

  const canCapture = active && cameraReady && !busy;
  return (
    <View style={styles.camera}>
      <CameraPermission loading={active && !cameraReady && !cameraError && !busy}>
        <Camera
          style={StyleSheet.absoluteFill}
          device="back"
          orientationSource="interface"
          isActive={active}
          outputs={outputs}
          allowHapticsAndSystemSoundsPlayback
          onStarted={() => { setCameraReady(true); setCameraError(undefined); }}
          onStopped={() => setCameraReady(false)}
          onError={(error) => { setCameraReady(false); setCameraError(error.message); }}
        />
        <LabelViewfinder />
      </CameraPermission>
      <View pointerEvents="box-none" style={[styles.overlay, { paddingTop: top + Spacing.three, paddingBottom: bottom + BottomTabInset + Spacing.three }]}>
        <OverlayCaption hint={storeOnly ? 'No signal — we’ll keep the label with your scan and finish when you’re back online' : undefined}>
          {LABEL_PROMPT}
        </OverlayCaption>
        <View style={styles.bottom}>
          {capture && <CaptureContextButton capture={capture} disabled={busy} />}
          {cameraError ? <OverlayCaption>{cameraError}</OverlayCaption> : busy ? <OverlayCaption><LoadingRing accessibilityLabel="Keeping the label…" color={Colors.light.overlayText} /></OverlayCaption> : null}
          <View style={styles.controls}>
            <GlassSurface isInteractive style={styles.importButton}>
              <Pressable accessibilityRole="button" accessibilityLabel="Import" disabled={busy}
                accessibilityState={{ disabled: busy }} onPress={importPhoto}
                style={({ pressed }) => [styles.importContent, (pressed || busy) && styles.dimmed]}>
                <Image source="sf:photo" style={styles.importIcon} tintColor={Colors.light.overlayText} />
              </Pressable>
            </GlassSurface>
            <Pressable accessibilityRole="button" accessibilityLabel="Take photo" disabled={!canCapture}
              accessibilityState={{ disabled: !canCapture, busy }} onPress={takePhoto}
              style={({ pressed }) => [styles.shutter, !canCapture && styles.disabled, pressed && styles.dimmed]}>
              <View style={styles.shutterCore} />
            </Pressable>
            <View style={styles.balance} />
          </View>
        </View>
      </View>
    </View>
  );
}

function StateCard({ title, detail, children }: { title?: string; detail?: string; children?: React.ReactNode }) {
  return (
    <ThemedView style={styles.container}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        {title && <ThemedText type="subtitle">{title}</ThemedText>}
        {detail && <ThemedText themeColor="textSecondary">{detail}</ThemedText>}
        {children}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: Spacing.four },
  camera: { flex: 1, backgroundColor: Colors.light.background },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.content },
  bottom: { alignSelf: 'stretch', alignItems: 'center', gap: Spacing.three },
  controls: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  importButton: { width: IMPORT_SIZE, height: IMPORT_SIZE, borderRadius: IMPORT_SIZE / 2, overflow: 'hidden' },
  importContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  importIcon: { width: 24, height: 24 },
  balance: { width: IMPORT_SIZE },
  shutter: {
    width: SHUTTER_SIZE, height: SHUTTER_SIZE, borderRadius: SHUTTER_SIZE / 2, borderWidth: SHUTTER_RING,
    borderColor: Colors.light.overlayText, alignItems: 'center', justifyContent: 'center',
  },
  shutterCore: {
    width: SHUTTER_SIZE - 2 * (SHUTTER_RING + SHUTTER_GAP), height: SHUTTER_SIZE - 2 * (SHUTTER_RING + SHUTTER_GAP),
    borderRadius: (SHUTTER_SIZE - 2 * (SHUTTER_RING + SHUTTER_GAP)) / 2, backgroundColor: Colors.light.overlayText,
  },
  disabled: { opacity: 0.4 },
  dimmed: { opacity: 0.7 },
});
