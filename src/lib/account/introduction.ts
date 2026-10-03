import { useSegments } from "expo-router";
import { useEffect, useState } from "react";

import { getSetting } from "@/db/repos/settings";
import { reportError } from "@/lib/observability";

import { getLocalProfileName } from "./local-profile";

export const WELCOME_SEEN_SETTING = "welcome-seen";

type Introduction = "checking" | "due" | "open" | "justEnded" | "over";

/**
 * Where the first-launch introduction stands for this person. It is `over` at once when onboarding was completed on an
 * earlier launch; otherwise it is `pending` until the welcome has opened and the stack is back on the tabs, so a sign-in
 * it hands off to counts, and `justEnded` for the rest of that launch.
 */
export function useIntroduction(owner: string): "pending" | "justEnded" | "over" {
  const [introduction, setIntroduction] = useState<Introduction>("checking");
  const top = useSegments()[0];
  if (introduction === "due" && top === "welcome") setIntroduction("open");
  if (introduction === "open" && top === "(tabs)") setIntroduction("justEnded");

  useEffect(() => {
    // Checked once per launch: a sign-in during the introduction switches the owner but must not end it early.
    if (introduction !== "checking") return;
    let cancelled = false;
    void Promise.all([getSetting(WELCOME_SEEN_SETTING), getLocalProfileName()])
      .then(([seen, name]) => {
        if (!cancelled) {
          setIntroduction(seen === "true" && (name || owner.startsWith("account:")) ? "over" : "due");
        }
      })
      .catch((cause: unknown) => {
        reportError(cause, "account.introduction.load");
        if (!cancelled) setIntroduction("over");
      });
    return () => {
      cancelled = true;
    };
  }, [introduction, owner]);

  return introduction === "justEnded" || introduction === "over" ? introduction : "pending";
}
