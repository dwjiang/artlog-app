import { addDatabaseChangeListener } from "expo-sqlite";
import { useEffect, useState } from "react";

import { latestVisitSaveAt } from "@/db/repos/visits";
import { reportError } from "@/lib/observability";

type Activity = { owner: string; visitLocalId: string; at?: number; error?: unknown };

export function useLatestVisitSave(visitLocalId: string | undefined, owner: string) {
  const [activity, setActivity] = useState<Activity>();
  useEffect(() => {
    if (!visitLocalId) return;
    let latest = 0;
    const load = () => {
      const read = ++latest;
      latestVisitSaveAt(visitLocalId, owner).then(
        (at) => {
          if (read === latest) setActivity({ owner, visitLocalId, at });
        },
        (error: unknown) => {
          reportError(error, "visit.reminder.activity", { level: "warning" });
          if (read === latest) setActivity({ owner, visitLocalId, error });
        },
      );
    };
    // Drizzle's live query only watches its FROM table; this aggregate also depends on both joined tables.
    const subscription = addDatabaseChangeListener(({ tableName }) => {
      if (tableName === "artworkPhotos" || tableName === "artworkEncounters" || tableName === "savedWorks") load();
    });
    load();
    return () => {
      latest++;
      subscription.remove();
    };
  }, [owner, visitLocalId]);
  const current = activity?.owner === owner && activity.visitLocalId === visitLocalId ? activity : undefined;
  return { at: current?.at, loading: !!visitLocalId && !current, error: current?.error };
}
