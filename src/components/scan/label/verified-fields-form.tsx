import { Image } from 'expo-image';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import type { LabelFieldName, LabelWarning } from '../../../../convex/lib/validators';

import { FieldInput } from '../field-input';
import { EvidenceBadge } from './evidence-badge';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { EVIDENCE_SOURCES, LABEL_FIELD_LABELS, LABEL_FIELD_NAMES, WARNING_MESSAGES, type LabelFormState } from '@/lib/label/fields';

export const UNLOCK_TITLE = 'Edit this field?';
export function unlockMessage(source: string): string {
  return `It was verified against ${source}; your shared entry will remain tentative, including any edits.`;
}

export type VerifiedFieldsFormProps = {
  state: LabelFormState;
  warnings: LabelWarning[];
  editable: boolean;
  onChange: (name: LabelFieldName, value: string) => void;
  onUnlock: (name: LabelFieldName) => void;
};

/** Verified fields locked with their source, the rest editable; the parent owns the state. */
export function VerifiedFieldsForm({ state, warnings, editable, onChange, onUnlock }: VerifiedFieldsFormProps) {
  function confirmUnlock(name: LabelFieldName) {
    const evidence = state[name].evidence;
    const source = (evidence && EVIDENCE_SOURCES[evidence]) ?? 'the museum’s records';
    Alert.alert(UNLOCK_TITLE, unlockMessage(source), [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Edit', onPress: () => onUnlock(name) },
    ]);
  }

  return (
    <View style={styles.form}>
      {warnings.length > 0 && (
        <View accessible accessibilityRole="alert" style={styles.warnings}>
          {warnings.map((warning) => <ThemedText key={warning} type="small">{WARNING_MESSAGES[warning]}</ThemedText>)}
        </View>
      )}
      {LABEL_FIELD_NAMES.map((name) => {
        const field = state[name];
        const label = LABEL_FIELD_LABELS[name];
        return (
          <View key={name} style={styles.field}>
            <View style={styles.header}>
              <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
              <EvidenceBadge field={field} />
            </View>
            <View style={styles.inputRow}>
              <FieldInput label={label} defaultValue={field.value} editable={editable} locked={field.locked} style={styles.input}
                autoCapitalize={name === 'date' || name === 'accession' ? 'none' : 'words'} onChangeText={(value) => onChange(name, value)} />
              {field.locked && editable && (
                <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} onPress={() => confirmUnlock(name)} style={styles.lockButton}>
                  <Image source="sf:lock.fill" tintColor={Colors.light.textSecondary} style={styles.lockIcon} />
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.three },
  warnings: {
    gap: Spacing.one, padding: Spacing.three, borderRadius: Spacing.two, borderLeftWidth: 3,
    borderLeftColor: Colors.light.warning, backgroundColor: Colors.light.backgroundElement,
  },
  field: { gap: Spacing.one },
  header: { alignItems: 'flex-start', gap: Spacing.one },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { flex: 1 },
  lockButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  lockIcon: { width: 18, height: 18 },
});
