import { useMutation } from "convex/react";
import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { FormSheet, formSheetStyles } from "@/components/form-sheet";
import { MotionPressable } from "@/components/motion-pressable";
import { ThemedText as Text } from "@/components/themed-text";
import { visitStyles } from "@/components/visits/visit-ui";
import { Gallery, SettingsOutline, Typography } from "@/constants/theme";
import { convexErrorCode } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { REPORT_NOUNS, REPORT_REASON_LABELS, reportTarget } from "@/lib/social/report";
import type { ReportInput, ReportReason } from "@/lib/social/types";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { useSheetSubmit } from "@/lib/ui/use-sheet-submit";
import { useDeviceReady } from "@/lib/use-device-ready";
import { LIMITS } from "@/shared/journal/limits";
import { REASONS_BY_KIND } from "@/shared/social/contracts";

import { api } from "../../../convex/_generated/api";

export function ReportScreen({ kind, id, renderId }: { kind?: string; id?: string; renderId?: string }) {
  const target = reportTarget(kind, id, renderId);
  const send = useMutation(api.reports.submit);
  const deviceReady = useDeviceReady();
  const [reason, setReason] = useState<ReportReason>();
  const [details, setDetails] = useState("");
  const noun = target ? REPORT_NOUNS[target.kind] : "item";
  const { busy, submit } = useSheetSubmit(
    async (input: ReportInput) => {
      await send(input);
      showToast("Report sent. Thank you.");
    },
    {
      offlineMessage: "Couldn’t send the report while offline.",
      onError: (cause, retry) => {
        const code = convexErrorCode(cause);
        if (code === "rate_limited") {
          showErrorToast("Couldn’t send the report. Try again tomorrow.");
        } else if (code === "not_found") {
          showErrorToast(`Couldn’t send the report. This ${noun} is no longer available.`);
        } else {
          reportError(cause, "report.submit");
          showErrorToast("Couldn’t send the report.", retry);
        }
      },
    },
  );
  if (!target) {
    return (
      <FormSheet title="Report" busy={false}>
        <Text style={visitStyles.fine}>This can’t be reported.</Text>
      </FormSheet>
    );
  }
  const needsDetails = reason === "other";
  return (
    <FormSheet title={`Report ${noun}`} busy={busy}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Reason" style={styles.card}>
        {REASONS_BY_KIND[target.kind].map((value, index) => {
          const selected = value === reason;
          return (
            <MotionPressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={REPORT_REASON_LABELS[value]}
              accessibilityState={{ checked: selected, disabled: busy }}
              disabled={busy}
              onPress={() => setReason(value)}
              style={[styles.option, index > 0 && styles.separator]}
            >
              <Text style={[styles.optionLabel, selected && styles.selected]}>{REPORT_REASON_LABELS[value]}</Text>
              {selected && <Image source="sf:checkmark" tintColor={Gallery.accent} style={styles.check} />}
            </MotionPressable>
          );
        })}
      </View>
      <TextInput
        accessibilityLabel={needsDetails ? "Details" : "Details (optional)"}
        value={details}
        onChangeText={setDetails}
        placeholder={needsDetails ? "Describe the problem…" : "Add details (optional)…"}
        maxLength={LIMITS.reportDetails}
        multiline
        editable={!busy}
        keyboardAppearance="light"
        selectionColor={Gallery.accent}
        placeholderTextColor={Gallery.muted}
        style={[formSheetStyles.input, { minHeight: 96 }]}
      />
      <GalleryButton
        label="Report"
        busyLabel="Sending…"
        variant="filled"
        fullWidth
        busy={busy}
        disabled={!deviceReady || !reason || (needsDetails && !details.trim())}
        onPress={() => {
          if (!reason) return;
          void submit({ target, reason, details: details.trim() || undefined });
        }}
      />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  card: { ...SettingsOutline, backgroundColor: Gallery.surface },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  // A hairline between rows at fractional offsets can round away entirely.
  separator: { borderTopWidth: SettingsOutline.borderWidth, borderColor: SettingsOutline.borderColor },
  optionLabel: { ...Typography.body, flex: 1, color: Gallery.ink },
  selected: { fontWeight: "600" },
  check: { width: 17, height: 17 },
});
