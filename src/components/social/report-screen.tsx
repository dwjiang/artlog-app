import { useMutation } from "convex/react";
import { useState } from "react";
import { View } from "react-native";

import { FormSheet, FormSheetTextArea } from "@/components/form-sheet";
import { ListRow } from "@/components/list-row";
import { TextScaleLimit, ThemedText as Text } from "@/components/themed-text";
import { visitStyles } from "@/components/visits/visit-ui";
import { convexErrorCode } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { REPORT_NOUNS, REPORT_REASON_LABELS, reportTarget, reportTitle } from "@/lib/social/report";
import type { ReportInput, ReportReason } from "@/lib/social/types";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { useSheetSubmit } from "@/lib/ui/use-sheet-submit";
import { useDeviceReady } from "@/lib/use-device-ready";
import { LIMITS } from "@/shared/journal/limits";
import { REASONS_BY_KIND } from "@/shared/social/contracts";

import { api } from "../../../convex/_generated/api";

// A reason shares its row with the checkmark column, leaving 274 points on a 375-point-wide iPhone. At the largest text
// size "Mispronounced" (about 6.6 em) needs 375, more than the whole row, and breaks mid-word; at 2.5× (40 points) it
// fits and the reason wraps between words.
const REASON_MAX_TEXT_SCALE = 2.5;

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
      edited: !!reason || !!details.trim(),
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
  const reasons = REASONS_BY_KIND[target.kind];
  return (
    <FormSheet
      title={reportTitle(target.kind)}
      busy={busy}
      grouped
      commit={{
        label: "Report",
        busyLabel: "Sending…",
        disabled: !deviceReady || !reason || (needsDetails && !details.trim()),
        onPress: () => {
          if (!reason) return;
          void submit({ target, reason, details: details.trim() || undefined });
        },
      }}
    >
      <View accessibilityRole="radiogroup" accessibilityLabel="Reason">
        <TextScaleLimit max={REASON_MAX_TEXT_SCALE}>
          {reasons.map((value, index) => (
            <ListRow
              key={value}
              title={REPORT_REASON_LABELS[value]}
              accessibilityRole="radio"
              accessory="check"
              selected={value === reason}
              disabled={busy}
              first={index === 0}
              last={index === reasons.length - 1}
              onPress={() => setReason(value)}
            />
          ))}
        </TextScaleLimit>
      </View>
      <FormSheetTextArea
        accessibilityLabel={needsDetails ? "Details" : "Details (optional)"}
        value={details}
        onChangeText={setDetails}
        placeholder={needsDetails ? "Describe the problem…" : "Add details (optional)…"}
        maxLength={LIMITS.reportDetails}
        editable={!busy}
        minHeight={96}
      />
    </FormSheet>
  );
}
