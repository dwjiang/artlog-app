import { Button, Host } from '@expo/ui';
import { useConvex } from 'convex/react';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useLocalOwner } from '@/lib/account/owner-store';
import model from '../../../shared/model/model-version.json';

import type { Id } from '../../../convex/_generated/dataModel';

import { LocalScanScreen } from './local-scan-screen';
import { CapturePhotosButton } from './capture-photos-button';
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
import { UnsupportedCard } from './states/unsupported-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { markScanReviewed, selectCaptureForScan } from '@/db/repos/pending-scans';
import { useScreenActive } from '@/hooks/use-screen-active';
import { captureFileUri } from '@/lib/files/photos';
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
  const { data: captures } = useLiveQuery(selectCaptureForScan(scanId, owner), [scanId, owner]);
  const capture = captures.find((row) => row.owner === owner);
  const captureStatus = capture?.status;
  const [selection, setSelection] = useState<ResultSelection>({});
  const [hasEdits, setHasEdits] = useState(false);
  const [sheet, setSheet] = useState<Sheet>({ open: false });
  const { saving, savedId, error: saveError, save } = useSaveResult();
  // The latest "Not right?" rejection, so a pick made before the server answers still resolves it.
  const rejection = useRef<Promise<Id<'feedback'> | null>>(undefined);
  const view = toResultViewState(scan, selection);
  const showMuseumSearch = !hasEdits && !selection.chosenObjectId && !saving && !savedId && !saveError;
  const museumSearch = useMuseumSearch(scan instanceof Error ? undefined : scan, isActive && showMuseumSearch);

  useEffect(() => {
    if (isActive && view.editable && captureStatus === 'identified') {
      void markScanReviewed(scanId, owner).catch((error: unknown) => console.warn('Could not mark the scan reviewed', error));
    }
  }, [isActive, scanId, view.editable, captureStatus, owner]);

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
    onSave: (draft: SnapshotDraft) => { void save({ scanId, capture, view, draft }); },
    onViewSaved: () => router.push({ pathname: '/(tabs)/(collection)/[savedId]', params: { savedId: savedId ?? '' } }),
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        contentContainerStyle={styles.content}
      >
        <CardHeader
          cropUri={capture ? captureFileUri(capture.cropPath) : undefined}
          corners={view.primary?.corners}
          inputSize={model.inputSize}
          kind={view.kind}
        />
        {capture && !savedId && <CapturePhotosButton objectId={view.kind === 'confident' ? view.primary?.objectId : undefined} path={capture.photoPath} title={view.primary?.title} visitId={capture.visitLocalId ?? undefined} disabled={saving} />}
        {view.kind === 'loading' && <ThemedText themeColor="textSecondary">Identifying…</ThemedText>}
        {view.kind === 'unsupported' && <UnsupportedCard {...saveProps} />}
        {view.kind === 'failed' && <FailedCard error={view.error} />}
        {view.editable && (!showMuseumSearch || (!museumSearch.flow && !museumSearch.restoring && !museumSearch.restoreError)) && (
          <ResultCard
            key={`${view.kind}:${view.primary?.objectId ?? 'none'}`}
            view={view}
            onNotRight={notRight}
            onPick={pickRunnerUp}
            onEdit={() => setHasEdits(true)}
            {...saveProps}
          />
        )}
        {view.editable && showMuseumSearch && <MuseumSearchSection search={museumSearch} scanId={scanId} capture={capture} />}
        {view.editable && view.kind !== 'confident' && (
          <Host matchContents colorScheme="light">
            <Button variant="outlined" label={LABEL_BUTTON} disabled={saving} onPress={openLabel} />
          </Host>
        )}
      </ScrollView>
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
  view: ResultViewState;
  saving: boolean;
  savedId?: string;
  saveError?: string;
  onNotRight: () => void;
  onPick: (candidate: ResultCandidate) => void;
  onEdit: () => void;
  onSave: (draft: SnapshotDraft) => void;
  onViewSaved: () => void;
};

/** Keyed by the named work, so a new primary resets the draft while streamed prose leaves edits alone. */
function ResultCard({ view, saving, savedId, saveError, onNotRight, onPick, onEdit, onSave, onViewSaved }: ResultCardProps) {
  const [draft, setDraft] = useState(() => draftFromCandidate(view.primary));
  const editable = !saving && !savedId;
  const suggestions = editable && view.kind !== 'confident' ? view.runnerUps : [];
  return (
    <>
      {view.primary && editable && (
        <Pressable accessibilityRole="button" onPress={onNotRight} style={styles.notRight}>
          <ThemedText type="small" themeColor="accent">Not right?</ThemedText>
        </Pressable>
      )}
      {view.primary?.identityStatus === 'tentative' && <TentativeOriginNotice />}
      <FieldsForm draft={draft} editable={editable} onChange={(field, value) => {
        onEdit();
        setDraft((current) => ({ ...current, [field]: value }));
      }} />
      {suggestions.length > 0 && (
        <View style={styles.section}>
          <ThemedText type="smallBold" themeColor="textSecondary">Maybe one of these?</ThemedText>
          <RunnerUps candidates={suggestions} onPick={onPick} />
        </View>
      )}
      <SaveBar
        canSave={canSave(draft)}
        saving={saving}
        savedId={savedId}
        error={saveError}
        onSave={() => onSave(draft)}
        onViewSaved={onViewSaved}
      />
      {view.kind === 'confident' && (
        <>
          <DocentSection title="About this work" docent={view.docent} factSheet={view.factSheet} pending={!view.docent?.length} />
          <RightNowSection rightNow={view.rightNow} />
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four },
  section: { gap: Spacing.two },
  notRight: { alignSelf: 'flex-end', paddingVertical: Spacing.one },
});
