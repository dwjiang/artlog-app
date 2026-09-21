import { LoadingRing } from '@/components/loading-ring';
import { useConvex } from 'convex/react';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, View } from 'react-native';

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
import { selectCaptureForScan } from '@/db/repos/pending-scans';
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
};

const LOCAL_PREFIX = 'local-';

export function ResultScreen({ scanId }: ResultScreenProps) {
  const owner = useLocalOwner();
  // The router reuses this screen for a new scan id; the key drops the previous card's draft, save and feedback state.
  if (scanId.startsWith(LOCAL_PREFIX)) return <LocalScanScreen key={`${owner}:${scanId}`} localId={scanId.slice(LOCAL_PREFIX.length)} />;
  return <ScanResultScreen key={`${owner}:${scanId}`} scanId={scanId as Id<'scans'>} />;
}

type Sheet = { open: boolean; notice?: string };

function ScanResultScreen({ scanId }: { scanId: Id<'scans'> }) {
  const owner = useLocalOwner();
  const router = useRouter();
  const isActive = useScreenActive();
  const client = useConvex();
  const scan = useScan(scanId);
  const { data: captures, updatedAt: captureUpdatedAt, error: captureError } = useLiveQuery(selectCaptureForScan(scanId, owner), [scanId, owner]);
  const capture = captures.find((row) => row.owner === owner);
  const labelCapture = !!capture && isLabelCapture(capture);
  const [selection, setSelection] = useState<ResultSelection>({});
  const [hasEdits, setHasEdits] = useState(false);
  const [sheet, setSheet] = useState<Sheet>({ open: false });
  const { saving, savedId, completion, error: saveError, save } = useSaveResult();
  // The latest "Not right?" rejection, so a pick made before the server answers still resolves it.
  const rejection = useRef<Promise<Id<'feedback'> | null>>(undefined);
  const view = toResultViewState(scan, selection);
  const showMuseumSearch = !hasEdits && !selection.chosenObjectId && !saving && !savedId && !saveError;
  const museumSearch = useMuseumSearch(scan instanceof Error ? undefined : scan, isActive && showMuseumSearch);

  useEffect(() => {
    if (isActive && labelCapture) router.replace({ pathname: '/label/[scanId]', params: { scanId } });
  }, [isActive, labelCapture, router, scanId]);

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
      .catch((error: unknown) => console.warn('Could not resolve the rejection', error));
  }

  const saveProps = {
    saving, savedId, saveError,
    captureInput: capture ? { scanId, capture, view } : undefined,
    onSave: (draft: SnapshotDraft) => { void save({ scanId, capture, view, draft }); },
    onViewSaved: () => router.push({ pathname: '/saved/[savedId]', params: { savedId: savedId ?? '' } }),
  };

  if (labelCapture) return <ThemedView style={styles.container}><LoadingRing accessibilityLabel="Opening your label…" style={{ flex: 1 }} /></ThemedView>;
  if (completion) return <CaptureCompletion completion={completion} />;

  const showCard = view.editable && (!showMuseumSearch || (!museumSearch.flow && !museumSearch.restoring && !museumSearch.restoreError));
  const header = <CardHeader cropUri={capture ? captureFileUri(scanPreviewPath(capture.cropPath)) : undefined} artworkTitle={view.primary?.title}
    loading={!captureUpdatedAt && !captureError} corners={view.primary?.corners} inputSize={model.inputSize} kind={view.kind}
    onNotRight={showCard && view.primary && !saving && !savedId ? notRight : undefined} />;
  const context = <>
    {capture && !savedId && <CaptureContextButton draftId={capture.photoPath} visitId={capture.visitLocalId ?? undefined} disabled={saving} />}
    {captureError && <ThemedText themeColor="error" accessibilityRole="alert">Couldn’t load the photo saved on this phone.</ThemedText>}
  </>;
  const search = view.editable && showMuseumSearch ? <MuseumSearchSection search={museumSearch} scanId={scanId} capture={capture} /> : undefined;
  return (
    <ThemedView style={styles.container}>
      {showCard ? <ResultCard key={`${view.kind}:${view.primary?.objectId ?? 'none'}`} view={view} header={header} context={context} search={search}
        onPick={pickRunnerUp} onEdit={() => setHasEdits(true)} onLabel={openLabel}
        savePhotoOnly={view.kind !== 'confident' && !hasEdits && !selection.chosenObjectId} onSavePhoto={() => { void save({ scanId, capture, draft: draftFromCandidate() }); }} {...saveProps} /> :
        <ScrollView contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" contentContainerStyle={styles.content}>
          {header}{context}
          {view.kind === 'loading' && <View style={styles.loading} accessibilityState={{ busy: true }}><LoadingRing color={Colors.light.accent} accessibilityLabel="Identifying…" /></View>}
          {view.kind === 'unsupported' && <UnsupportedCard {...saveProps} />}
          {view.kind === 'failed' && <><FailedCard error={view.error} />{capture && <SaveAnywayForm {...saveProps} />}<GalleryButton label="Scan another artwork" fullWidth onPress={() => { router.dismissAll(); router.navigate('/(tabs)/(scan)/scan'); }} /></>}
          {search}
          {view.editable && view.kind !== 'confident' && <GalleryButton label={LABEL_BUTTON} variant="filled" fullWidth disabled={saving} onPress={openLabel} />}
        </ScrollView>}
      <NotRightSheet
        open={sheet.open}
        notice={sheet.notice}
        onDismiss={() => setSheet({ open: false })}
        runnerUps={view.runnerUps}
        onPick={pickRunnerUp}
        onLabel={openLabel}
      />
    </ThemedView>
  );
}

type ResultCardProps = {
  captureInput?: Omit<SaveResultInput, 'draft'>;
  view: ResultViewState;
  saving: boolean;
  savedId?: string;
  saveError?: string;
  header: ReactNode;
  context?: ReactNode;
  search?: ReactNode;
  onLabel: () => void;
  onPick: (candidate: ResultCandidate) => void;
  onEdit: () => void;
  onSave: (draft: SnapshotDraft) => void;
  onSavePhoto: () => void;
  savePhotoOnly: boolean;
  onViewSaved: () => void;
};

/** Keyed by the named work, so a new primary resets the draft while streamed prose leaves edits alone. */
function ResultCard({ captureInput, view, saving, savedId, saveError, header, context, search, onLabel, onPick, onEdit, onSave, onSavePhoto, savePhotoOnly, onViewSaved }: ResultCardProps) {
  const [draft, setDraft] = useState(() => draftFromCandidate(view.primary));
  const [editingDetails, setEditingDetails] = useState(false);
  const { bottom } = useSafeAreaInsets();
  const editable = !saving && !savedId;
  const suggestions = editable && view.kind !== 'confident' ? view.runnerUps : [];
  const photos = useCapturePhotos(captureInput ? {
    ...captureInput, view: savePhotoOnly ? undefined : captureInput.view, draft: savePhotoOnly ? draftFromCandidate() : draft,
  } : undefined, !editable);
  return <>
    <Stack.Toolbar placement="right"><Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Scan options" tintColor={Gallery.ink} hidesSharedBackground>
      <Stack.Toolbar.MenuAction disabled={!editable} onPress={() => setEditingDetails((value) => !value)}>{editingDetails ? 'Done editing' : 'Edit details'}</Stack.Toolbar.MenuAction>
      <Stack.Toolbar.MenuAction disabled={photos.unavailable} onPress={photos.open}>{photos.label}</Stack.Toolbar.MenuAction>
    </Stack.Toolbar.Menu></Stack.Toolbar>
    <ScrollView contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" contentContainerStyle={styles.content}>
      {header}
      <View style={styles.identity}>
        {draft.artist && <ThemedText type="title" style={{ fontSize: 40, lineHeight: 46 }}>{draft.artist}</ThemedText>}
        {!editingDetails && <>
          <ThemedText style={styles.workTitle}>{draft.title || 'Artwork scan'}</ThemedText>
          {view.kind === 'confident' && !!draft.medium && <ThemedText variant="secondary" themeColor="textSecondary">{draft.medium}{draft.date ? ` · ${draft.date}` : ''}</ThemedText>}
          {view.kind === 'confident' && !draft.medium && !!draft.date && <ThemedText variant="secondary" themeColor="textSecondary">{draft.date}</ThemedText>}
        </>}
      </View>
      {view.kind === 'soft' && <ThemedText variant="secondary">This could be a match. Scan the wall label to confirm.</ThemedText>}
      {view.primary?.identityStatus === 'tentative' && <TentativeOriginNotice />}
      {!editingDetails && view.kind !== 'confident' && <GalleryButton label="Add details (optional)" disabled={!editable} onPress={() => setEditingDetails(true)} />}
      {editingDetails && <FieldsForm draft={draft} editable={editable} onChange={(field, value) => {
        onEdit(); setDraft((current) => ({ ...current, [field]: value }));
      }} />}
      {view.kind === 'confident' && context}
      {suggestions.length > 0 && <View style={styles.section}><HighlightHeading>Other possibilities</HighlightHeading><RunnerUps candidates={suggestions} onPick={onPick} /></View>}
      {view.kind !== 'confident' && context}
      {view.kind === 'confident' && <>
        <DocentSection title="About this work" docent={view.docent} factSheet={view.factSheet} pending={!view.docent?.length} />
        <RightNowSection rightNow={view.rightNow} />
      </>}
      {search}
    </ScrollView>
    <View style={[styles.save, { paddingBottom: Math.max(12, bottom) }]}>
      <SaveBar canSave={savePhotoOnly || canSave(draft)} saving={saving} savedId={savedId} error={saveError}
        saveLabel={savePhotoOnly ? 'Save photo for later' : view.kind === 'confident' ? 'Save to collection' : 'Save with these details'} labelFirst={view.kind !== 'confident'}
        onSave={() => savePhotoOnly ? onSavePhoto() : onSave(draft)} onLabel={onLabel} onViewSaved={onViewSaved} />
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
  loading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
