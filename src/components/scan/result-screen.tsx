import { useConvex } from 'convex/react';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import model from '../../../shared/model-version.json';

import type { Id } from '../../../convex/_generated/dataModel';

import { CardHeader } from './result/card-header';
import { DocentSection } from './result/docent-section';
import { FieldsForm } from './result/fields-form';
import { NotRightSheet } from './result/not-right-sheet';
import { RightNowSection } from './result/right-now-section';
import { RunnerUps } from './result/runner-ups';
import { SaveBar } from './result/save-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { getCaptureForScan } from '@/db/repos/pending-scans';
import type { PendingScan } from '@/db/schema';
import { captureFileUri } from '@/lib/files/photos';
import { rejectMatch, resolveWithRunnerUp } from '@/lib/result/feedback';
import { saveResult } from '@/lib/result/save';
import { canSave, draftFromCandidate, type SnapshotDraft } from '@/lib/result/snapshot';
import { toResultViewState, type ResultCandidate, type ResultSelection, type ResultViewState } from '@/lib/result/state';
import { useScan } from '@/lib/result/use-scan';

export type ResultScreenProps = {
  scanId: string;
};

export function ResultScreen({ scanId }: ResultScreenProps) {
  // Queued captures carry a local id until they are identified (plan 05.05 renders their states).
  if (scanId.startsWith('local-')) {
    return (
      <StateCard title="Waiting for signal" detail="We’ll identify this painting when you’re back online." />
    );
  }
  // The router reuses this screen for a new scan id; the key drops the previous card's draft, save and feedback state.
  return <ScanResultScreen key={scanId} scanId={scanId as Id<'scans'>} />;
}

type Sheet = { open: boolean; notice?: string };

function ScanResultScreen({ scanId }: { scanId: Id<'scans'> }) {
  const router = useRouter();
  const client = useConvex();
  const scan = useScan(scanId);
  const [capture, setCapture] = useState<PendingScan>();
  const [selection, setSelection] = useState<ResultSelection>({});
  const [sheet, setSheet] = useState<Sheet>({ open: false });
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  // The latest "Not right?" rejection, so a pick made before the server answers still resolves it.
  const rejection = useRef<Promise<Id<'feedback'> | null>>(undefined);
  const view = toResultViewState(scan, selection);

  useEffect(() => {
    let active = true;
    getCaptureForScan(scanId).then(
      (row) => { if (active) setCapture(row); },
      (error: unknown) => console.warn('Could not load the capture for this scan', error),
    );
    return () => { active = false; };
  }, [scanId]);

  function openLabel() {
    setSheet({ open: false });
    router.push({ pathname: '/label/[scanId]', params: { scanId } });
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

  async function save(draft: SnapshotDraft) {
    if (!capture) {
      setSaveError('Your photo of this scan isn’t on this phone, so it can’t be saved.');
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    try {
      const { localId } = await saveResult({ scanId, capture, view, draft });
      setSavedId(localId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (error) {
      console.warn('Could not save the work', error);
      setSaveError('Couldn’t save. Try again.');
    } finally {
      setSaving(false);
    }
  }

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
        {view.kind === 'loading' && <ThemedText themeColor="textSecondary">Identifying…</ThemedText>}
        {view.kind === 'unsupported' && <StateNote title="Update the app to identify this painting" detail={view.error} />}
        {view.kind === 'failed' && <StateNote title="Couldn’t identify this painting" detail={view.error} />}
        {view.editable && (
          <ResultCard
            key={`${view.kind}:${view.primary?.objectId ?? 'none'}`}
            view={view}
            saving={saving}
            savedId={savedId}
            saveError={saveError}
            onNotRight={notRight}
            onPick={pickRunnerUp}
            onSave={save}
            onLabel={openLabel}
            onViewSaved={() => router.push({ pathname: '/(tabs)/(collection)/[savedId]', params: { savedId: savedId ?? '' } })}
          />
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
  onSave: (draft: SnapshotDraft) => void;
  onLabel: () => void;
  onViewSaved: () => void;
};

/** Keyed by the named work, so a new primary resets the draft while streamed prose leaves edits alone. */
function ResultCard({ view, saving, savedId, saveError, onNotRight, onPick, onSave, onLabel, onViewSaved }: ResultCardProps) {
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
      <FieldsForm draft={draft} editable={editable} onChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))} />
      {suggestions.length > 0 && (
        <View style={styles.section}>
          <ThemedText type="smallBold" themeColor="textSecondary">Maybe one of these?</ThemedText>
          <RunnerUps candidates={suggestions} onPick={onPick} />
        </View>
      )}
      <SaveBar
        kind={view.kind}
        canSave={canSave(draft)}
        saving={saving}
        savedId={savedId}
        error={saveError}
        onSave={() => onSave(draft)}
        onLabel={onLabel}
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

function StateNote({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">{title}</ThemedText>
      {detail && <ThemedText themeColor="textSecondary">{detail}</ThemedText>}
    </View>
  );
}

function StateCard({ title, detail }: { title: string; detail: string }) {
  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        <StateNote title={title} detail={detail} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four },
  section: { gap: Spacing.two },
  notRight: { alignSelf: 'flex-end', paddingVertical: Spacing.one },
});
