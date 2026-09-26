import { useRouter } from "expo-router";
import { useEffect, useState } from "react";

import { getSetting, setSetting } from "@/db/repos/settings";
import { useScreenActive } from "@/hooks/use-screen-active";
import { WELCOME_SEEN_SETTING } from "@/lib/account/introduction";
import { useLocalOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";

export function WelcomePrompt() {
  const active = useScreenActive();
  const owner = useLocalOwner();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!active || checked) return;
    let cancelled = false;
    void (async () => {
      const seen = await getSetting(WELCOME_SEEN_SETTING);
      if (cancelled) return;
      await setSetting(WELCOME_SEEN_SETTING, "true");
      if (cancelled) return;
      setChecked(true);
      if (seen !== "true" && !owner.startsWith("account:")) {
        router.push("/welcome");
      }
    })().catch((cause) => {
      reportError(cause, "account.welcome.load");
      if (!cancelled) setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [active, checked, router, owner]);
  return null;
}
