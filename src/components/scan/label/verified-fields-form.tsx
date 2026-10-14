import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { FieldInput } from "@/components/scan/field-input";
import { ThemedText } from "@/components/themed-text";
import { Colors, Spacing } from "@/constants/theme";
import { LABEL_FIELD_LABELS, WARNING_MESSAGES, type LabelFormState } from "@/lib/label/fields";
import { LIMITS } from "@/shared/journal/limits";

import type { LabelFieldName, LabelWarning } from "../../../../convex/lib/validators";

export type VerifiedFieldsFormProps = {
  state: LabelFormState;
  warnings: LabelWarning[];
  editable: boolean;
  onChange: (name: LabelFieldName, value: string) => void;
};

export function VerifiedFieldsForm({ state, warnings, editable, onChange }: VerifiedFieldsFormProps) {
  const [more, setMore] = useState(false);
  const names: LabelFieldName[] = [
    "title",
    "artist",
    "date",
    "medium",
    ...(more ? (["accession", "creditLine"] as const) : []),
  ];
  return (
    <View style={styles.form}>
      {warnings.length > 0 && (
        <View accessible accessibilityRole="alert" style={styles.warnings}>
          {warnings.map((warning) => (
            <ThemedText key={warning} type="small">
              {WARNING_MESSAGES[warning]}
            </ThemedText>
          ))}
        </View>
      )}
      {names.map((name) => {
        const field = state[name];
        const label = LABEL_FIELD_LABELS[name];
        return (
          <View key={name} style={styles.field}>
            <View style={styles.header}>
              <ThemedText type="small" themeColor="textSecondary">
                {label}
              </ThemedText>
            </View>
            <View style={styles.inputRow}>
              <FieldInput
                label={label}
                defaultValue={field.value}
                editable={editable}
                style={styles.input}
                autoCapitalize={name === "date" || name === "accession" ? "none" : "words"}
                maxLength={LIMITS.typedDetail}
                onChangeText={(value) => onChange(name, value)}
              />
            </View>
          </View>
        );
      })}
      <GalleryButton label={more ? "Fewer details" : "More details"} onPress={() => setMore((value) => !value)} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.three },
  warnings: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderLeftWidth: 3,
    borderLeftColor: Colors.light.warning,
    backgroundColor: Colors.light.backgroundElement,
  },
  field: { gap: Spacing.one },
  header: { alignItems: "flex-start", gap: Spacing.one },
  inputRow: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  input: { flex: 1 },
});
