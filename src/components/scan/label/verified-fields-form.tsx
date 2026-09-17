import { Host, TextInput } from '@expo/ui';
import { Image } from 'expo-image';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import type { LabelFieldName, LabelWarning } from '../../../../convex/lib/validators';

import { EvidenceBadge } from './evidence-badge';
import { ThemedText } from '@/components/themed-text';
import { Colors, Gallery, Spacing } from '@/constants/theme';
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
              <Host matchContents={{ vertical: true }} colorScheme="light" style={styles.host}>
                <TextInput
                  defaultValue={field.value}
                  placeholder={label}
                  editable={editable && !field.locked}
                  autoCapitalize={name === 'date' || name === 'accession' ? 'none' : 'words'}
                  autoCorrect={false}
                  onChangeText={(value) => onChange(name, value)}
                  style={field.locked ? styles.inputLocked : styles.input}
                />
              </Host>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  host: { flex: 1 },
  input: { paddingHorizontal: 11, paddingVertical: 10, borderRadius: 9, backgroundColor: Gallery.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: Gallery.separator },
  inputLocked: { paddingHorizontal: 11, paddingVertical: 10, borderRadius: 9, backgroundColor: Gallery.fill },
  lockButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  lockIcon: { width: 18, height: 18 },
});
