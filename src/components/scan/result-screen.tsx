import { reportError } from '@/lib/observability';
import { retryPendingScan } from '@/lib/queue/queue';
import { ScanCropEditor } from './scan-crop-editor';
import { LoadingRing } from '@/components/loading-ring';
import { SearchConsentSheet } from './result/search-consent-sheet';
import { useConvex } from 'convex/react';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { isLabelCapture } from '@/lib/capture/photo-draft';
import { useLocalOwner } from '@/lib/account/owner-store';
import model from '../../../shared/model/model-version.json';

import type { Id } from '../../../convex/_generated/dataModel';

import { LocalScanScreen } from './local-scan-screen';
import { CaptureCompletion } from './capture-completion';
import { CaptureContextButton } from './capture-context-button';
import type { SaveResultInput } from '@/lib/result/save';
import { useCapturePhotos } from './capture-photos-button';
import { CardHeader } from './result/card-header';
import { DocentSection } from './result/docent-section';
import { FieldsForm } from './result/fields-form';
import { MuseumSearchSection } from './result/museum-search-section';
import { NotRightSheet } from './result/not-right-sheet';
import { RightNowSection } from './result/right-now-section';
import { TentativeOriginNotice } from './result/tentative-origin-notice';
import { RunnerUps } from './result/runner-ups';
import { LABEL_BUTTON, SaveBar } from './result/save-bar';
import { FailedCard } from './states/failed-card';
import { SaveAnywayForm } from './states/save-anyway-form';
import { UnsupportedCard } from './states/unsupported-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { HighlightHeading } from '@/components/highlight-heading';
import { GalleryButton } from '@/components/collection/gallery-button';
import { Colors, Gallery, Spacing } from '@/constants/theme';
import { markFailed, selectCaptureForScan } from '@/db/repos/pending-scans';
import { useScreenActive } from '@/hooks/use-screen-active';
import { captureFileUri, scanPreviewPath } from '@/lib/files/photos';
import { useMuseumSearch } from '@/lib/museum-search/use-museum-search';
import { handOffLabelRejection, rejectMatch, resolveWithRunnerUp } from '@/lib/result/feedback';
import { canSave, draftFromCandidate, type SnapshotDraft } from '@/lib/result/snapshot';
import { toResultViewState, type ResultCandidate, type ResultSelection, type ResultViewState } from '@/lib/result/state';
import { useSaveResult } from '@/lib/result/use-save-result';
import { useScan } from '@/lib/result/use-scan';

export type ResultScreenProps = {
  scanId: string;
  manual?: boolean;
};

const LOCAL_PREFIX = 'local-';

export function ResultScreen({ scanId, manual = false }: ResultScreenProps) {
  const owner = useLocalOwner();
  // The router reuses this screen for a new scan id; the key drops the previous card's draft, save and feedback state.
  if (scanId.startsWith(LOCAL_PREFIX)) return <LocalScanScreen key={`${owner}:${scanId}:${manual}`} localId={scanId.slice(LOCAL_PREFIX.length)} manual={manual} />;
  return <ScanResultScreen key={`${owner}:${scanId}:${manual}`} scanId={scanId as Id<'scans'>} startManual={manual} />;
}

type Sheet = { open: boolean; notice?: string };

function ScanResultScreen({ scanId, startManual }: { scanId: Id<'scans'>; startManual: boolean }) {
  const owner = useLocalOwner();
  const router = useRouter();
  const isActive = useScreenActive();
  const client = useConvex();
  const scan = useScan(scanId);
  const { data: captures, updatedAt: captureUpdatedAt, error: captureError } = useLiveQuery(selectCaptureForScan(scanId, owner), [scanId, owner]);
  useEffect(() => { if (captureError) reportError(captureError, 'result.load_capture'); }, [captureError]);
  const capture = captures.find((row) => row.owner === owner);
  const labelCapture = !startManual && !!capture && isLabelCapture(capture);
  const [selection, setSelection] = useState<ResultSelection>({});
  const [manual, setManual] = useState(startManual);
  const [searchConsent, setSearchConsent] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const [retrying, setRetrying] = useState(false);
  const [editingCrop, setEditingCrop] = useState(false);
  const [hasEdits, setHasEdits] = useState(false);
  const [sheet, setSheet] = useState<Sheet>({ open: false });
  const { saving, savedId, completion, error: saveError, save } = useSaveResult();
  // The latest "Not right?" rejection, so a pick made before the server answers still resolves it.
  const rejection = useRef<Promise<Id<'feedback'> | null>>(undefined);
  const view: ResultViewState = manual ? { kind: 'unidentified', editable: true, runnerUps: [] } : toResultViewState(scan, selection);
  const showMuseumSearch = !manual && !hasEdits && !selection.chosenObjectId && !saving && !savedId && !saveError;
  const museumSearch = useMuseumSearch(scan instanceof Error ? undefined : scan, isActive && showMuseumSearch && !editingCrop);

  useEffect(() => {
    if (isActive && labelCapture) router.replace({ pathname: '/label/[scanId]', params: { scanId } });
  }, [isActive, labelCapture, router, scanId]);

  function adjustCrop() {
    if (hasEdits) Alert.alert('Adjust this crop?', 'Recognition will run again. Unsaved artwork details will be discarded.', [
      { text: 'Keep editing', style: 'cancel' }, { text: 'Adjust crop', onPress: () => { setHasEdits(false); setEditingCrop(true); } },
    ]);
    else setEditingCrop(true);
  }

  function openLabel() {
    setSheet({ open: false });
    if (rejection.current) handOffLabelRejection(scanId, rejection.current);
    const intent = museumSearch.flow || museumSearch.restoring || museumSearch.restoreError ? 'capture' : 'review';
    router.push({ pathname: '/label/[scanId]', params: { scanId, intent } });
  }

  function notRight() {
    const primary = view.primary;
    if (!primary) return;
    setSelection((current) => ({ ...current, rejectedObjectIds: [...(current.rejectedObjectIds ?? []), primary.objectId] }));
    setSheet({ open: true });
    rejection.current = rejectMatch(client, scanId, primary.objectId).then(
      (feedbackId) => {
        if (!feedbackId) setSheet((current) => current.open ? { ...current, notice: 'This device can’t send feedback yet.' } : current);
        return feedbackId;
      },
      (error: unknown) => {
        reportError(error, 'result.reject_match');
        console.warn('Could not record the rejection', error);
        setSheet((current) => current.open ? { ...current, notice: 'Couldn’t record your feedback, but you can still pick a work.' } : current);
        return null;
      },
    );
  }

  function pickRunnerUp(candidate: ResultCandidate) {
    setSelection((current) => ({ ...current, chosenObjectId: candidate.objectId }));
    setSheet({ open: false });
    const pending = rejection.current;
    if (!pending) return;
    rejection.current = undefined;
    void pending.then((feedbackId) => feedbackId && resolveWithRunnerUp(client, feedbackId, candidate.objectId))
      .catch((error: unknown) => { reportError(error, 'result.resolve_feedback'); console.warn('Could not resolve the rejection', error); });
  }

  const saveProps = {
    saving, savedId, saveError,
    captureInput: capture ? { scanId, capture, view } : undefined,
    onSave: (draft: SnapshotDraft) => { void save({ scanId, capture, view, draft }); },
    onViewSaved: () => router.push({ pathname: '/saved/[savedId]', params: { savedId: savedId ?? '' } }),
  };

  if (editingCrop && capture) return <ScanCropEditor capture={capture} onCancel={() => setEditingCrop(false)} />;
  if (labelCapture) return <ThemedView style={styles.container}><LoadingRing accessibilityLabel="Opening your label…" style={{ flex: 1 }} /></ThemedView>;
  if (completion) return <CaptureCompletion completion={completion} />;

  const showCard = view.editable && (!showMuseumSearch || (!museumSearch.flow && !museumSearch.restoring && !museumSearch.restoreError));
  const header = <CardHeader cropUri={capture ? captureFileUri(scanPreviewPath(capture.cropPath)) : undefined} artworkTitle={view.primary?.title}
    loading={!captureUpdatedAt && !captureError} corners={view.primary?.corners} inputSize={model.inputSize} kind={view.kind}
    onNotRight={showCard && view.primary && !saving && !savedId ? notRight : undefined} />;
  const context = <>
    {capture && !savedId && <GalleryButton label="Adjust crop" icon="crop" disabled={saving} onPress={adjustCrop} />}
    {capture && !savedId && <CaptureContextButton capture={capture} disabled={saving} />}
    {captureError && <ThemedText themeColor="error" accessibilityRole="alert">Couldn’t load the photo saved on this phone.</ThemedText>}
  </>;
  const search = view.editable && showMuseumSearch ? <MuseumSearchSection search={museumSearch} scanId={scanId} capture={capture} /> : undefined;
  const searchIdle = !museumSearch.running && !museumSearch.flow && !museumSearch.restoring && !museumSearch.restoreError;
  return (
    <ThemedView style={styles.container}>
      {showCard ? <ResultCard key={`${view.kind}:${view.primary?.objectId ?? 'none'}:${manual}`} manual={manual} view={view} header={header} context={context} search={search}
        onSearchMuseum={showMuseumSearch && museumSearch.available && searchIdle ? () => { if (museumSearch.consented) void museumSearch.search(); else setSearchConsent(true); } : undefined}
        onPick={pickRunnerUp} onEdit={() => setHasEdits(true)} onLabel={openLabel}
        savePhotoOnly={view.kind !== 'confident' && !hasEdits && !selection.chosenObjectId} onSavePhoto={() => { void save({ scanId, capture, draft: draftFromCandidate() }); }} {...saveProps} /> :
        <ScrollView contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" contentContainerStyle={styles.content}>
          {header}{context}
          {view.kind === 'loading' && <View style={styles.loading} accessibilityState={{ busy: true }}><LoadingRing color={Colors.light.accent} accessibilityLabel="Identifying…" /></View>}
          {view.kind === 'unsupported' && <UnsupportedCard {...saveProps} />}
          {view.kind === 'failed' && <><FailedCard error={view.error} retrying={retrying} onRetry={capture ? () => {
            if (retrying) return;
            setRetrying(true); setRetryError(undefined);
            void markFailed(capture.localId, view.error ?? 'Identification failed', scanId, owner).then(() => retryPendingScan(capture.localId)).then(() => router.replace({ pathname: '/result/[scanId]', params: { scanId: `local-${capture.localId}` } }))
              .catch((error: unknown) => { reportError(error, 'queue.retry'); setRetryError('Couldn’t retry. Your photo is still here.'); }).finally(() => setRetrying(false));
          } : undefined} />{retryError && <ThemedText themeColor="error" accessibilityRole="alert">{retryError}</ThemedText>}{capture && <SaveAnywayForm {...saveProps} compact />}<GalleryButton label="Scan another artwork" fullWidth onPress={() => { router.dismissAll(); router.navigate('/(tabs)/(scan)/scan'); }} /></>}
          {search}
          {view.editable && view.kind !== 'confident' && <GalleryButton label={LABEL_BUTTON} variant="filled" fullWidth disabled={saving} onPress={openLabel} />}
        </ScrollView>}
      <SearchConsentSheet open={searchConsent} onDismiss={() => setSearchConsent(false)} onGranted={() => { setSearchConsent(false); void museumSearch.search(); }} />
      <NotRightSheet
        open={sheet.open}
        notice={sheet.notice}
        onDismiss={() => setSheet({ open: false })}
        runnerUps={view.runnerUps}
        onPick={pickRunnerUp}
        onLabel={openLabel}
        onManual={() => { setManual(true); setHasEdits(true); setSheet({ open: false }); }}
        onSavePhoto={capture ? () => { setSheet({ open: false }); void save({ scanId, capture, draft: draftFromCandidate() }); } : undefined}
      />
    </ThemedView>
  );
}

type ResultCardProps = {
  manual?: boolean;
  captureInput?: Omit<SaveResultInput, 'draft'>;
  view: ResultViewState;
  saving: boolean;
  savedId?: string;
  saveError?: string;
  header: ReactNode;
  context?: ReactNode;
  search?: ReactNode;
  onLabel: () => void;
  onSearchMuseum?: () => void;
  onPick: (candidate: ResultCandidate) => void;
  onEdit: () => void;
  onSave: (draft: SnapshotDraft) => void;
  onSavePhoto: () => void;
  savePhotoOnly: boolean;
  onViewSaved: () => void;
};

/** Keyed by the named work, so a new primary resets the draft while streamed prose leaves edits alone. */
function ResultCard({ manual = false, captureInput, view, saving, savedId, saveError, header, context, search, onLabel, onSearchMuseum, onPick, onEdit, onSave, onSavePhoto, savePhotoOnly, onViewSaved }: ResultCardProps) {
  const [draft, setDraft] = useState(() => draftFromCandidate(view.primary));
  const [editingDetails, setEditingDetails] = useState(manual);
  const { bottom } = useSafeAreaInsets();
  const editable = !saving && !savedId;
  const suggestions = editable && view.kind !== 'confident' ? view.runnerUps : [];
  const photos = useCapturePhotos(captureInput ? {
    ...captureInput, view: savePhotoOnly ? undefined : captureInput.view, draft: savePhotoOnly ? draftFromCandidate() : draft,
  } : undefined, !editable);
  return <>
    <Stack.Toolbar placement="right"><Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Scan options" tintColor={Gallery.ink} hidesSharedBackground>
      <Stack.Toolbar.MenuAction disabled={!editable} onPress={() => setEditingDetails((value) => !value)}>{editingDetails ? 'Done editing' : 'Edit details'}</Stack.Toolbar.MenuAction>
      {view.kind === 'confident' && <Stack.Toolbar.MenuAction disabled={!editable} onPress={onLabel}>Scan the label</Stack.Toolbar.MenuAction>}
      <Stack.Toolbar.MenuAction disabled={photos.unavailable} onPress={photos.open}>{photos.label}</Stack.Toolbar.MenuAction>
    </Stack.Toolbar.Menu></Stack.Toolbar>
    <ScrollView contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" contentContainerStyle={styles.content}>
      {header}
      <View style={styles.identity}>
        <ThemedText type="title" style={{ fontSize: 36, lineHeight: 42 }}>{view.kind === 'soft' ? `Could this be ${draft.title}?` : draft.title || 'Unidentified artwork'}</ThemedText>
        {!editingDetails && <>
          {view.kind !== 'soft' && <ThemedText style={styles.workTitle}>{draft.artist}{draft.date ? ` · ${draft.date}` : ''}</ThemedText>}
          {view.kind === 'confident' && <ThemedText variant="metadata" themeColor="textSecondary">{[draft.medium, draft.institution].filter(Boolean).join(' · ')}</ThemedText>}
        </>}
      </View>
      {!view.primary && !editingDetails && <ThemedText themeColor="textSecondary">We couldn’t identify this artwork yet. Keep the photo and add what you know.</ThemedText>}
      {view.kind === 'soft' && <><ThemedText themeColor="textSecondary">The image looks similar, but we’re not sure. Scan the museum label to confirm the details.</ThemedText><ThemedText variant="metadata" themeColor="textSecondary">Possible artist · {draft.artist || 'Unknown'}</ThemedText></>}
      {view.primary?.identityStatus === 'tentative' && <TentativeOriginNotice />}
      {!editingDetails && view.kind === 'unidentified' && <View style={{ borderWidth: 0.5, borderColor: Gallery.separator, borderRadius: 12, overflow: 'hidden' }}>
        {onSearchMuseum && <GalleryButton label="Search museum collection" icon="magnifyingglass" fullWidth disabled={!editable} onPress={onSearchMuseum} />}
        <GalleryButton label="Enter details myself" icon="pencil" fullWidth disabled={!editable} onPress={() => setEditingDetails(true)} />
      </View>}
      {editingDetails && <FieldsForm draft={draft} editable={editable} onChange={(field, value) => {
        onEdit(); setDraft((current) => ({ ...current, [field]: value }));
      }} />}
      {suggestions.length > 0 && <View style={styles.section}><HighlightHeading>Other possibilities</HighlightHeading><RunnerUps candidates={suggestions} onPick={onPick} /></View>}
      {view.kind !== 'confident' && context}
      {view.kind === 'confident' && <>
        <DocentSection title="About this work" docent={view.docent} factSheet={view.factSheet} pending={!view.docent?.length} />
        <RightNowSection rightNow={view.rightNow} />
        {context}
      </>}
      {search}
    </ScrollView>
    <View style={[styles.save, { paddingBottom: Math.max(12, bottom) }]}>
      <SaveBar canSave={savePhotoOnly || canSave(draft)} saving={saving} savedId={savedId} error={saveError}
        saveLabel={savePhotoOnly ? 'Save photo for later' : view.kind === 'confident' ? 'Save to collection' : 'Save with these details'} labelFirst={view.kind !== 'confident'}
        onSave={() => savePhotoOnly ? onSavePhoto() : onSave(draft)} onLabel={view.kind === 'confident' ? undefined : onLabel} onViewSaved={onViewSaved} />
    </View>
  </>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16, gap: Spacing.two },
  identity: { gap: 2 },
  workTitle: { fontSize: 20, lineHeight: 24, fontWeight: '600' },
  section: { gap: 4 },
  save: { paddingHorizontal: 20, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Gallery.separator, backgroundColor: Gallery.paper },
  loading: { gap: Spacing.two },
});
