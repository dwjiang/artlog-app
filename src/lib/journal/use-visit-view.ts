import { reportError } from "@/lib/observability";
import { useEffect, useRef, useState } from "react";
import { getSetting, setSetting } from "@/db/repos/settings";

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
    void Promise.all([getSetting(key), getSetting(`remember-visit-view:${owner}`)])
      .then(([value, remember]) => {
        if (active && !changed.current) {
          setMode(remember !== "false" && value === "list" ? "list" : "globe");
        }
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
  }, [key, owner]);
  function changeMode(value: VisitViewMode) {
    changed.current = true;
    setMode(value);
    setError(undefined);
    writes.current = writes.current
      .then(async () => {
        if ((await getSetting(`remember-visit-view:${owner}`)) !== "false") {
          await setSetting(key, value);
        }
      })
      .catch((cause) => {
        reportError(cause, "journal.view.save");
        setError("The view preference could not be saved.");
      });
  }
  return { mode, changeMode, error };
}
