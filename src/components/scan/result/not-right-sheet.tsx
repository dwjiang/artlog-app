import { BottomSheet } from '@expo/ui';
import { StyleSheet, View } from 'react-native';

import { RunnerUps } from './runner-ups';
import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ResultCandidate } from '@/lib/result/state';

export type NotRightSheetProps = {
  open: boolean;
  onDismiss: () => void;
  runnerUps: ResultCandidate[];
  onPick: (candidate: ResultCandidate) => void;
  onLabel: () => void;
  /** A one-line note when the rejection could not be recorded; the choices stay usable. */
  notice?: string;
};

/** "Not right?": runner-ups first, then the label. */
export function NotRightSheet({ open, onDismiss, runnerUps, onPick, onLabel, notice }: NotRightSheetProps) {
  const hasRunnerUps = runnerUps.length > 0;
  return (
    <BottomSheet isPresented={open} onDismiss={onDismiss}>
      <View style={styles.content}>
        <ThemedText type="subtitle">{hasRunnerUps ? 'Maybe one of these?' : 'Not in our index yet'}</ThemedText>
        {notice && <ThemedText type="small" themeColor="textSecondary">{notice}</ThemedText>}
        {hasRunnerUps && <RunnerUps candidates={runnerUps} onPick={onPick} />}
        <GalleryButton label={hasRunnerUps ? 'None of these — point at the label' : 'Point at the label'} variant="filled" fullWidth onPress={onLabel} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three, paddingBottom: Spacing.four },
});
