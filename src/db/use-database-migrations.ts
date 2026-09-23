import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { useEffect, useState } from "react";
import { getSetting } from "./repos/settings";
import { initializeOwner } from "@/lib/account/owner-store";
import { getInstallationId } from "@/lib/installation-storage";

import migrations from "./migrations/migrations";
import { db, describeDatabase } from "./client";

export type MigrationState = { success: boolean; error?: Error };

// DatabaseGate prevents reads until the pending migrations have been applied.
export function useDatabaseMigrations(): MigrationState {
  const state = useMigrations(db, migrations);
  const [ownerReady, setOwnerReady] = useState(false);
  const [ownerError, setOwnerError] = useState<Error>();
  useEffect(() => {
    if (!state.success) return;
    let active = true;
    void getSetting("activeJournalOwner")
      .then((stored) => {
        if (!active) return;
        initializeOwner(getInstallationId(), stored);
        setOwnerReady(true);
        if (__DEV__) console.debug("Local database ready", describeDatabase());
      })
      .catch((error: unknown) => {
        if (active) setOwnerError(error instanceof Error ? error : new Error(String(error)));
      });
    return () => {
      active = false;
    };
  }, [state.success]);
  return { success: state.success && ownerReady, error: state.error ?? ownerError };
}
