import type { ReactNode } from "react";
import { ScrollView, StyleSheet } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { SourceChip } from "@/components/scan/result/source-chip";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Gallery, Spacing } from "@/constants/theme";
import { toConfirmedFields, type LabelFormState } from "@/lib/label/fields";

import type { LabelFieldName, LabelWarning } from "../../../../convex/lib/validators";
import { VerifiedFieldsForm } from "./verified-fields-form";

export const CONFIRM_BUTTON = "Confirm details";

export type ConfirmDetailsFormProps = {
  form: LabelFormState;
  /** Where a label reading came from; typed details have none. */
  source?: { label: string; url?: string };
  warnings?: LabelWarning[];
  /** Remounts the fields when the reading behind them changes. */
  formKey?: string | number;
  confirming: boolean;
  disabled?: boolean;
  confirmDisabled?: boolean;
  error?: string;
  children?: ReactNode;
  onChange: (name: LabelFieldName, value: string) => void;
  onConfirm: () => void;
};

/** The owner's last look at a work's details before its result page names it. */
export function ConfirmDetailsForm({
  form,
  source,
  warnings = [],
  formKey,
  confirming,
  disabled = false,
  confirmDisabled = false,
  error,
  children,
  onChange,
  onConfirm,
}: ConfirmDetailsFormProps) {
  const canConfirm = toConfirmedFields(form) !== null;
  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        contentContainerStyle={styles.content}
      >
        {source && (
          <ThemedText type="small" style={styles.source}>
            {source.label}
          </ThemedText>
        )}
        <ThemedText type="title">Confirm artwork details</ThemedText>
        <ThemedText themeColor="textSecondary">
          {source ? "Edit anything that doesn’t look right." : "Add what you know about this work."}
        </ThemedText>
        {source?.url && <SourceChip label="Museum page" url={source.url} />}
        <VerifiedFieldsForm
          key={formKey}
          state={form}
          warnings={warnings}
          editable={!confirming && !disabled}
          onChange={onChange}
        />
        <GalleryButton
          label={CONFIRM_BUTTON}
          variant="filled"
          fullWidth
          busy={confirming}
          busyLabel="Confirming…"
          disabled={!canConfirm || confirming || disabled || confirmDisabled}
          onPress={onConfirm}
        />
        {!canConfirm && (
          <ThemedText type="small" themeColor="textSecondary">
            Add a title to continue.
          </ThemedText>
        )}
        {error && (
          <ThemedText type="small" themeColor="error" accessibilityRole="alert">
            {error}
          </ThemedText>
        )}
        {children}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.content, gap: Spacing.three },
  source: {
    alignSelf: "flex-start",
    padding: 6,
    backgroundColor: Gallery.highlight,
    color: Gallery.accent,
  },
});
