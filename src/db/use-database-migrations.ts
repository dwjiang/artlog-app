import { useEffect, useState } from "react";

import { initializeOwner } from "@/lib/account/owner-store";
import { getInstallationId } from "@/lib/installation-storage";

import { db, describeDatabase } from "./client";
import { migrateDatabase } from "./migrate-database";
import { getSetting } from "./repos/settings";

export type MigrationState = { success: boolean; error?: Error };

// DatabaseGate prevents reads until the pending migrations have been applied.
export function useDatabaseMigrations(): MigrationState {
  const [state, setState] = useState<MigrationState>({ success: false });
  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const installationId = getInstallationId();
        await migrateDatabase(db, installationId);
        const stored = await getSetting("activeJournalOwner");
        if (!active) return;
        initializeOwner(installationId, stored);
        if (__DEV__) console.debug("Local database ready", describeDatabase());
        setState({ success: true });
      } catch (error) {
        if (active) setState({ success: false, error: error instanceof Error ? error : new Error(String(error)) });
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, []);
  return state;
}
