import { useMutation } from "convex/react";
import Constants from "expo-constants";
import { useState } from "react";
import { Platform } from "react-native";

import { FormSheet, FormSheetTextArea } from "@/components/form-sheet";
import { convexErrorCode } from "@/lib/network-error";
import { reportError } from "@/lib/observability";
import { showErrorToast, showToast } from "@/lib/ui/toast";
import { useSheetSubmit } from "@/lib/ui/use-sheet-submit";
import { useDeviceReady } from "@/lib/use-device-ready";
import { LIMITS } from "@/shared/journal/limits";

import { api } from "../../../convex/_generated/api";

export function SendFeedbackScreen() {
  const send = useMutation(api.appFeedback.submit);
  const deviceReady = useDeviceReady();
  const [message, setMessage] = useState("");
  const { busy, submit } = useSheetSubmit(
    async (text: string) => {
      await send({
        message: text,
        appVersion: `${Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "Unknown"} (${Constants.nativeBuildVersion ?? "dev"})`,
        osVersion: `iOS ${Platform.Version}`,
      });
      showToast("Feedback sent. Thank you.");
    },
    {
      edited: !!message.trim(),
      offlineMessage: "Couldn’t send feedback while offline.",
      onError: (cause, retry) => {
        reportError(cause, "feedback.send");
        if (convexErrorCode(cause) === "rate_limited") {
          showErrorToast("Couldn’t send feedback. Try again tomorrow.");
        } else {
          showErrorToast("Couldn’t send feedback.", retry);
        }
      },
    },
  );

  return (
    <FormSheet
      title="Send Feedback"
      busy={busy}
      commit={{
        label: "Send",
        busyLabel: "Sending…",
        disabled: !deviceReady || !message.trim(),
        onPress: () => {
          void submit(message.trim());
        },
      }}
    >
      <FormSheetTextArea
        accessibilityLabel="Feedback"
        value={message}
        onChangeText={setMessage}
        placeholder="Describe a problem or share an idea…"
        maxLength={LIMITS.feedbackMessage}
        autoFocus
        editable={!busy}
        minHeight={160}
      />
    </FormSheet>
  );
}
