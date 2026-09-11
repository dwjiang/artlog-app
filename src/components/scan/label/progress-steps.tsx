import { Image } from 'expo-image';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { LabelStage } from '@/lib/label/flow';

export const STEP_LABELS = {
  read: 'Reading the label…',
  qr: 'Fetching the museum’s page…',
  records: 'Checking the museum’s records…',
  wikidata: 'Checking Wikidata…',
  web: 'Searching the web…',
  images: 'Comparing images…',
} as const;

// The server runs the three verification checks inside one call, so their rows advance together.
const ORDER: Record<LabelStage, number> = { qr: 0, read: 0, verify: 1, 'image-check': 2, done: 3 };
const ICON_SIZE = 20;

function stepsFor(qr: boolean): { stage: LabelStage; label: string }[] {
  return [
    qr ? { stage: 'qr', label: STEP_LABELS.qr } : { stage: 'read', label: STEP_LABELS.read },
    { stage: 'verify', label: STEP_LABELS.records },
    { stage: 'verify', label: STEP_LABELS.wikidata },
    { stage: 'verify', label: STEP_LABELS.web },
    { stage: 'image-check', label: STEP_LABELS.images },
  ];
}

/** The label flow's stages as a vertical stepper: ticks behind, a spinner on the current group, grey ahead. */
export function ProgressSteps({ stage, qr }: { stage: LabelStage; qr: boolean }) {
  const current = ORDER[stage];
  const steps = stepsFor(qr);
  const firstActive = steps.findIndex((step) => ORDER[step.stage] === current);
  return (
    <View style={styles.list}>
      {steps.map(({ stage: step, label }, index) => {
        const done = ORDER[step] < current;
        const active = ORDER[step] === current;
        const spinner = index === firstActive;
        return (
          <View key={label} style={styles.row} accessibilityLabel={label} accessibilityState={{ checked: done, busy: active }}>
            <View style={styles.icon}>
              {done ? <Image source="sf:checkmark.circle.fill" tintColor={Colors.light.success} style={styles.glyph} />
                : spinner ? <ActivityIndicator size="small" color={Colors.light.accent} />
                : <View style={[styles.dot, active && styles.dotActive]} />}
            </View>
            <ThemedText themeColor={done || active ? 'text' : 'textSecondary'}>{label}</ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  icon: { width: ICON_SIZE, height: ICON_SIZE, alignItems: 'center', justifyContent: 'center' },
  glyph: { width: ICON_SIZE, height: ICON_SIZE },
  dot: { width: Spacing.two, height: Spacing.two, borderRadius: Spacing.one, backgroundColor: Colors.light.backgroundSelected },
  dotActive: { backgroundColor: Colors.light.accent },
});
