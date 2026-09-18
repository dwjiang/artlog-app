import { StyleSheet, View } from 'react-native';

import { FieldInput } from '../field-input';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { SNAPSHOT_FIELDS, type SnapshotDraft, type SnapshotField } from '@/lib/result/snapshot';

export const FIELD_LABELS: Record<SnapshotField, string> = {
  title: 'Title', artist: 'Artist', date: 'Date', medium: 'Medium', institution: 'Institution',
};

export type FieldsFormProps = {
  draft: SnapshotDraft;
  editable: boolean;
  onChange: (field: SnapshotField, value: string) => void;
};

/** Every suggested field is editable before saving; the parent owns the draft. */
export function FieldsForm({ draft, editable, onChange }: FieldsFormProps) {
  return (
    <View style={styles.form}>
      {SNAPSHOT_FIELDS.map((field) => (
        <View key={field} style={styles.field}>
          <ThemedText type="small" themeColor="textSecondary">{FIELD_LABELS[field]}</ThemedText>
          <FieldInput label={FIELD_LABELS[field]} defaultValue={draft[field]} editable={editable}
            autoCapitalize={field === 'date' ? 'none' : 'words'} onChangeText={(value) => onChange(field, value)} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.three },
  field: { gap: Spacing.one },
});
