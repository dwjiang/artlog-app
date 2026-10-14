import { removeSetting, setSetting, takeSetting } from "@/db/repos/settings";
import { convex } from "@/lib/convex-client";
import { reportError } from "@/lib/observability";

import { api } from "../../../convex/_generated/api";

// Only anonymous answers wait here; signed-in choices must finish or surface a retryable error.
export const SAFETY_CHECKS_SETTING = "safety-checks";

export async function answerSafetyChecks(enabled: boolean, signedIn: boolean) {
  if (!signedIn) {
    await setSetting(SAFETY_CHECKS_SETTING, enabled ? "on" : "off");
    return;
  }
  await removeSetting(SAFETY_CHECKS_SETTING);
  await convex.mutation(api.accounts.setSafetyChecks, { enabled });
}

// Consume before linking: an interrupted attempt must not leave consent for the next account.
export async function takeSafetyChecksAnswer(): Promise<boolean | undefined> {
  const answer = await takeSetting(SAFETY_CHECKS_SETTING);
  return answer === "on" ? true : answer === "off" ? false : undefined;
}

export async function carrySafetyChecksAnswer(answer: boolean | undefined) {
  if (answer === undefined) return;
  try {
    // A decline always applies (5.1.2(i)); an allow only fills an unanswered account, so it never overrides a decline.
    const choice = answer ? { enabled: true, ifUnset: true } : { enabled: false };
    await convex.mutation(api.accounts.setSafetyChecks, choice);
  } catch (cause) {
    // A failed carry leaves the account's existing answer intact; an unanswered account still needs consent to post.
    reportError(cause, "social.safety_checks.carry");
  }
}
