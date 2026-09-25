import { useEffect, useRef, useState } from "react";

import { getSetting, setSetting } from "@/db/repos/settings";
import { reportError } from "@/lib/observability";

export type VisitViewMode = "list" | "globe";

/** `mode` stays undefined until the stored preference is read so the globe never mounts for a List user. */
export function useVisitView(owner: string) {
  const [mode, setMode] = useState<VisitViewMode>();
  const [error, setError] = useState<string>();
  const changed = useRef(false);
  const writes = useRef(Promise.resolve());
  const key = `visit-view:${owner}`;
  useEffect(() => {
    let active = true;
    void getSetting(key)
      .then((value) => {
        if (active && !changed.current) setMode(value === "list" ? "list" : "globe");
      })
      .catch((cause) => {
        reportError(cause, "journal.view.load");
        if (active) {
          setError("The view preference could not load.");
          if (!changed.current) setMode("globe");
        }
      });
    return () => {
      active = false;
    };
  }, [key]);
  function changeMode(value: VisitViewMode) {
    changed.current = true;
    setMode(value);
    setError(undefined);
    writes.current = writes.current
      .then(() => setSetting(key, value))
      .catch((cause) => {
        reportError(cause, "journal.view.save");
        setError("The view preference could not be saved.");
      });
  }
  return { mode, changeMode, error };
}
