import { Pressable, StyleSheet, View } from 'react-native';

import { CaptureCompletion } from '../capture-completion';
import { GalleryButton } from '@/components/collection/gallery-button';
import type { CaptureCompletion as Completion } from '@/lib/capture/completion';
import { ContributeResult } from './contribute-result';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ContributionOutcome } from '@/lib/label/contribute';

export const SHARE_BUTTON = 'Retry saving to the shared index';
// The pre-save notice: wording changes need the operator's review.
export const SHARING_NOTICE = 'Also saves the confirmed label, a numeric fingerprint of your photo and a small artwork crop to the shared index for other visitors. Your full photos stay private.';

export type LabelActionsProps = {
  allowContribution?: boolean;
  canSave: boolean;
  saving: boolean;
  sharing: boolean;
  savedId?: string;
  completion?: Completion;
  shared?: ContributionOutcome;
  saveError?: string;
  shareError?: string;
  onSave: () => void;
  onShare: () => void;
  onViewSaved: () => void;
};

export function LabelActions({
  allowContribution = true, canSave, saving, sharing, savedId, completion, shared, saveError, shareError, onSave, onShare, onViewSaved,
}: LabelActionsProps) {
  return (
    <View style={styles.bar}>
      {completion ? <CaptureCompletion completion={completion} sharedToIndex={shared?.status === 'tentative'} inline /> : savedId ? (
        <Pressable accessibilityRole="link" onPress={onViewSaved} style={styles.saved}>
          <ThemedText themeColor="accent">Saved · View in collection</ThemedText>
        </Pressable>
      ) : (
        <>
          <GalleryButton label="Save to collection" variant="filled" fullWidth busy={saving} busyLabel="Saving…" disabled={!canSave || saving} onPress={onSave} />
          <ThemedText type="small" themeColor="textSecondary">{allowContribution ? SHARING_NOTICE : 'Save privately to your collection.'}</ThemedText>
          {!canSave && <ThemedText type="small" themeColor="textSecondary">Add a title to save this work.</ThemedText>}
          {saveError && <ThemedText type="small" themeColor="error" accessibilityRole="alert">{saveError}</ThemedText>}
        </>
      )}
      <ContributionStatus sharing={sharing} shared={shared} shareError={shareError} onShare={onShare} />
    </View>
  );
}

export function ContributionStatus({ sharing, shared, shareError, onShare }: Pick<LabelActionsProps, 'sharing' | 'shared' | 'shareError' | 'onShare'>) {
  return <>
    {shared && <ContributeResult result={shared} />}
    {sharing && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">Saving to the shared index…</ThemedText>}
    {shareError && <>
      <ThemedText type="small" themeColor="error" accessibilityRole="alert">{shareError}. Your artwork is saved to your collection.</ThemedText>
      <GalleryButton label={SHARE_BUTTON} variant="outlined" fullWidth disabled={sharing} onPress={onShare} />
    </>}
  </>;
}

const styles = StyleSheet.create({
  bar: { gap: Spacing.two },
  saved: { minHeight: 44, justifyContent: 'center', paddingVertical: Spacing.two },
});
