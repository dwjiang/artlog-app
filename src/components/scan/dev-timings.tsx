import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { CaptureTimings } from '@/lib/capture/stages';

export function formatCaptureTimings({ total, ...stages }: CaptureTimings): string {
  const parts = Object.entries(stages).map(([stage, ms]) => `${stage} ${Math.round(ms)}`);
  return [`Capture ${Math.round(total)} ms`, ...parts].join(' · ');
}

/** Development builds only: the stage breakdown of the last capture, tucked bottom-left over the preview. */
export function DevTimings({ timings }: { timings?: CaptureTimings }) {
  if (!__DEV__ || !timings) return null;
  return (
    <View style={styles.timings}>
      <ThemedText type="code" themeColor="overlayText">{formatCaptureTimings(timings)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  timings: { alignSelf: 'flex-start', backgroundColor: Colors.light.overlayScrim, borderRadius: Spacing.two, paddingVertical: Spacing.one, paddingHorizontal: Spacing.two },
});
