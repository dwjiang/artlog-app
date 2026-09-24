import { Switch } from "@expo/ui";
import { useEffect, useRef, useState } from "react";

import { GroupedFooter, GroupedSection, ValueRow } from "@/components/grouped-list";
import { getSetting, setSetting } from "@/db/repos/settings";
import { captureOwner, useLocalOwner } from "@/lib/account/owner-store";
import { reportError } from "@/lib/observability";

export function VisitPreference() {
  return <OwnedPreference key={useLocalOwner()} />;
}
function OwnedPreference() {
  const owner = useLocalOwner();
  const [remember, setRemember] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    void getSetting(`remember-visit-view:${owner}`)
      .then((value) => {
        if (active) setRemember(value !== "false");
      })
      .catch((cause) => {
        reportError(cause, "settings.visit-view.load");
        if (active) setError("The preference could not load.");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [owner]);
  // The local write lands within a frame or two, so the switch flips at once instead of flashing a disabled state.
  async function change(value: boolean) {
    if (saving.current) return;
    const session = captureOwner();
    saving.current = true;
    setRemember(value);
    setError(undefined);
    try {
      await setSetting(`remember-visit-view:${owner}`, String(value));
    } catch (cause) {
      reportError(cause, "settings.visit-view.save");
      if (session.isCurrent()) {
        setRemember(!value);
        setError("The preference could not be saved.");
      }
    } finally {
      saving.current = false;
    }
  }
  return (
    <GroupedSection
      footer={
        <GroupedFooter tone={error ? "destructive" : "muted"}>
          {error ?? "Open Visits in your last List or Globe view. When off, new sessions start with the globe."}
        </GroupedFooter>
      }
    >
      {!loaded ? (
        <ValueRow label="Remember visit view" loading />
      ) : (
        <Switch
          label="Remember visit view"
          value={remember}
          onValueChange={(value) => {
            void change(value);
          }}
        />
      )}
    </GroupedSection>
  );
}
