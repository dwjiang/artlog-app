import { Pressable, StyleSheet, View } from 'react-native';

import { CaptureCompletion } from '../capture-completion';
import { GalleryButton } from '@/components/collection/gallery-button';
import type { CaptureCompletion as Completion } from '@/lib/capture/completion';
import { ContributeResult } from './contribute-result';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ContributionOutcome } from '@/lib/label/contribute';
import { useSharingDefault } from '@/lib/settings/use-sharing-default';

export const SHARE_BUTTON = 'Add to the shared index';

export type LabelActionsProps = {
  allowContribution?: boolean;
  canSave: boolean;
  canShare: boolean;
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
  allowContribution = true, canSave, canShare, saving, sharing, savedId, completion, shared, saveError, shareError, onSave, onShare, onViewSaved,
}: LabelActionsProps) {
  const offerSharing = useSharingDefault() && allowContribution;
  return (
    <View style={styles.bar}>
      {completion ? <CaptureCompletion completion={completion} sharedToIndex={shared?.status === 'tentative'} inline /> : savedId ? (
        <Pressable accessibilityRole="link" onPress={onViewSaved} style={styles.saved}>
          <ThemedText themeColor="accent">Saved · View in collection</ThemedText>
        </Pressable>
      ) : (
        <>
          <GalleryButton label={saving ? 'Saving…' : 'Save to collection'} variant="filled" fullWidth disabled={!canSave || saving} onPress={onSave} />
          {!canSave && <ThemedText type="small" themeColor="textSecondary">Add a title to save this work.</ThemedText>}
          {saveError && <ThemedText type="small">{saveError}</ThemedText>}
        </>
      )}
      {shared ? (
        <ContributeResult result={shared} />
      ) : offerSharing ? (
        <>
          <GalleryButton label={sharing ? 'Sharing…' : SHARE_BUTTON} variant="outlined" fullWidth disabled={!canShare || sharing} onPress={onShare} />
          {!canShare && <ThemedText type="small" themeColor="textSecondary">A title and an artist are needed to share.</ThemedText>}
          {shareError && <ThemedText type="small">{shareError}</ThemedText>}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: Spacing.two },
  saved: { paddingVertical: Spacing.two },
});
