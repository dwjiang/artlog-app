import { useMutation } from "convex/react";
import Constants from "expo-constants";
import { useState } from "react";
import { Platform, TextInput } from "react-native";

import { GalleryButton } from "@/components/collection/gallery-button";
import { FormSheet, formSheetStyles } from "@/components/form-sheet";
import { Gallery } from "@/constants/theme";
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
    <FormSheet title="Send feedback" busy={busy}>
      <TextInput
        accessibilityLabel="Feedback"
        value={message}
        onChangeText={setMessage}
        placeholder="Describe a problem or share an idea…"
        maxLength={LIMITS.feedbackMessage}
        multiline
        autoFocus
        editable={!busy}
        keyboardAppearance="light"
        selectionColor={Gallery.accent}
        placeholderTextColor={Gallery.muted}
        style={[formSheetStyles.input, { minHeight: 160 }]}
      />
      <GalleryButton
        label="Send"
        busyLabel="Sending…"
        variant="filled"
        fullWidth
        busy={busy}
        disabled={!deviceReady || !message.trim()}
        onPress={() => {
          void submit(message.trim());
        }}
      />
    </FormSheet>
  );
}
