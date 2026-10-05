import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { getSetting } from "@/db/repos/settings";
import { useScreenActive } from "@/hooks/use-screen-active";
import { WELCOME_SEEN_SETTING } from "@/lib/account/introduction";
import { useLocalOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";

export function WelcomePrompt() {
  const active = useScreenActive();
  const owner = useLocalOwner();
  const router = useRouter();
  const [checkedOwner, setCheckedOwner] = useState<string>();
  useEffect(() => {
    if (!active || checkedOwner === owner) return;
    let cancelled = false;
    void (async () => {
      const seen = await getSetting(WELCOME_SEEN_SETTING);
      if (cancelled) return;
      setCheckedOwner(owner);
      // Rechecked per owner because erasing local data starts a new owner with the welcome unseen.
      if (seen !== "true") router.push("/welcome");
    })().catch((cause) => {
      reportError(cause, "account.welcome.load");
      if (!cancelled) setCheckedOwner(owner);
    });
    return () => {
      cancelled = true;
    };
  }, [active, checkedOwner, router, owner]);
  return null;
}
