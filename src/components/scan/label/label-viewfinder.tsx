import { StyleSheet, View } from 'react-native';

import { OverlayCaption } from '@/components/scan/overlay-caption';
import { Colors, Spacing } from '@/constants/theme';

export const LABEL_HINT = 'Fill the frame with the label, flat and in focus';

const CORNER_SIZE = 20;
const STROKE = 3;

/** A 3:2 guide for the wall label: corner marks over the preview and the framing hint. */
export function LabelViewfinder({ hint = LABEL_HINT }: { hint?: string }) {
  return (
    <View pointerEvents="none" style={styles.fill} accessibilityLabel="Label guide">
      <View style={styles.guide}>
        <View style={[styles.corner, styles.topLeft]} />
        <View style={[styles.corner, styles.topRight]} />
        <View style={[styles.corner, styles.bottomLeft]} />
        <View style={[styles.corner, styles.bottomRight]} />
      </View>
      <OverlayCaption>{hint}</OverlayCaption>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
  guide: { width: '84%', aspectRatio: 3 / 2 },
  corner: { position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE, borderColor: Colors.light.overlayText },
  topLeft: { top: 0, left: 0, borderTopWidth: STROKE, borderLeftWidth: STROKE, borderTopLeftRadius: Spacing.one },
  topRight: { top: 0, right: 0, borderTopWidth: STROKE, borderRightWidth: STROKE, borderTopRightRadius: Spacing.one },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: STROKE, borderLeftWidth: STROKE, borderBottomLeftRadius: Spacing.one },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: STROKE, borderRightWidth: STROKE, borderBottomRightRadius: Spacing.one },
});
