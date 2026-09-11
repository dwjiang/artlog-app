import { Button, Host } from '@expo/ui';
import { Pressable, StyleSheet, View } from 'react-native';

import { ContributeResult } from './contribute-result';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ContributionOutcome } from '@/lib/label/contribute';

export const SHARE_BUTTON = 'Add to the shared index';

export type LabelActionsProps = {
  canSave: boolean;
  canShare: boolean;
  saving: boolean;
  sharing: boolean;
  savedId?: string;
  shared?: ContributionOutcome;
  saveError?: string;
  shareError?: string;
  onSave: () => void;
  onShare: () => void;
  onViewSaved: () => void;
};

/** Save follows the result card's path; sharing is always offered because the consent sheet is the opt-in (design §4.5). */
export function LabelActions({
  canSave, canShare, saving, sharing, savedId, shared, saveError, shareError, onSave, onShare, onViewSaved,
}: LabelActionsProps) {
  return (
    <View style={styles.bar}>
      {savedId ? (
        <Pressable accessibilityRole="link" onPress={onViewSaved} style={styles.saved}>
          <ThemedText themeColor="accent">Saved · View in collection</ThemedText>
        </Pressable>
      ) : (
        <>
          <Host matchContents colorScheme="light">
            <Button label={saving ? 'Saving…' : 'Save to collection'} disabled={!canSave || saving} onPress={onSave} />
          </Host>
          {!canSave && <ThemedText type="small" themeColor="textSecondary">Add a title to save this work.</ThemedText>}
          {saveError && <ThemedText type="small">{saveError}</ThemedText>}
        </>
      )}
      {shared ? (
        <ContributeResult result={shared} />
      ) : (
        <>
          <Host matchContents colorScheme="light">
            <Button variant="outlined" label={sharing ? 'Sharing…' : SHARE_BUTTON} disabled={!canShare || sharing} onPress={onShare} />
          </Host>
          {!canShare && <ThemedText type="small" themeColor="textSecondary">A title and an artist are needed to share.</ThemedText>}
          {shareError && <ThemedText type="small">{shareError}</ThemedText>}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: Spacing.two },
  saved: { paddingVertical: Spacing.two },
});
