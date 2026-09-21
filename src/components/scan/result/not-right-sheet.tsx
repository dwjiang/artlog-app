import { BottomSheet, RNHostView } from '@expo/ui';
import { ScrollView, StyleSheet } from 'react-native';

import { RunnerUps } from './runner-ups';
import { GalleryButton } from '@/components/collection/gallery-button';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
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
    <BottomSheet contentPadding={0} snapPoints={['full']} containerColor={Colors.light.background} isPresented={open} onDismiss={onDismiss}>
      <RNHostView>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">{hasRunnerUps ? 'Other possible matches' : 'Not in our index yet'}</ThemedText>
          {notice && <ThemedText type="small" themeColor="error" accessibilityRole="alert">{notice}</ThemedText>}
          {hasRunnerUps && <RunnerUps candidates={runnerUps} onPick={onPick} />}
          <GalleryButton label={hasRunnerUps ? 'None of these — point at the label' : 'Point at the label'} variant="filled" fullWidth onPress={onLabel} />
        </ScrollView>
      </RNHostView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { gap: Spacing.three, padding: Spacing.content, paddingBottom: Spacing.six },
});
