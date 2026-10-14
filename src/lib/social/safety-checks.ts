import { useMutation } from "convex/react";
import { useState } from "react";
import { Alert, type AlertButton } from "react-native";

import { reportError } from "@/lib/observability";
import { showErrorToast } from "@/lib/ui/toast";

import { api } from "../../../convex/_generated/api";
import type { SocialSession } from "./use-social-session";

// App Review asks apps to say who receives text sent to a third-party AI (5.1.2(i)), so the provider stays named.
export const SAFETY_CHECKS_USE =
  "Our moderation provider, OpenAI, checks your comments, visit notes and bio for harmful content before others see them.";
export const SAFETY_CHECKS_LIMIT = "It gets only the text, not your name or account.";
export const SAFETY_CHECKS_FOOTER = `${SAFETY_CHECKS_USE} When this is off, you can’t post them.`;

export function confirmAlert(title: string, message: string, buttons: (AlertButton & { text: string })[]) {
  return new Promise<string | undefined>((resolve) =>
    Alert.alert(
      title,
      message,
      buttons.map((button) => ({ ...button, onPress: () => resolve(button.text) })),
      { cancelable: true, onDismiss: () => resolve(undefined) },
    ),
  );
}

export function useSafetyChecks({ safetyChecks }: Pick<SocialSession, "safetyChecks">) {
  const set = useMutation(api.accounts.setSafetyChecks);
  const [busy, setBusy] = useState(false);
  const change = async (enabled: boolean) => {
    setBusy(true);
    const changed = await set({ enabled }).then(
      () => true,
      (cause: unknown) => {
        reportError(cause, "social.safety_checks.change");
        showErrorToast(`Couldn’t turn ${enabled ? "on" : "off"} safety checks. Try again.`);
        return false;
      },
    );
    setBusy(false);
    return changed;
  };
  /** Shows who gets the text before anything is sent, then turns the checks on if the person agrees. */
  const turnOn = async () => {
    const choice = await confirmAlert("Turn on safety checks?", `${SAFETY_CHECKS_USE} ${SAFETY_CHECKS_LIMIT}`, [
      { text: "Cancel", style: "cancel" },
      { text: "Turn On", isPreferred: true },
    ]);
    return choice === "Turn On" && change(true);
  };
  const turnOff = async () => {
    const choice = await confirmAlert(
      "Turn off safety checks?",
      "You won’t be able to post comments, visit notes or a bio until you turn them back on. What you’ve already posted stays.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Turn Off", style: "destructive" },
      ],
    );
    return choice === "Turn Off" && change(false);
  };
  return { enabled: safetyChecks, busy, turnOn, turnOff };
}
export type SafetyChecks = ReturnType<typeof useSafetyChecks>;
