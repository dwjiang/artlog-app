import { useEffect, useState } from "react";

import { initializeOwner } from "@/lib/account/owner-store";
import { getInstallationId } from "@/lib/installation-storage";

import { db, describeDatabase } from "./client";
import { appliedMigrationCount, bundledMigrationCount, migrateDatabase } from "./migrate-database";
import { getSetting } from "./repos/settings";

export type MigrationState = {
  success: boolean;
  error?: Error;
  diagnostics?: Record<string, string | number | null>;
};

// DatabaseGate prevents reads until the pending migrations have been applied.
export function useDatabaseMigrations(): MigrationState {
  const [state, setState] = useState<MigrationState>({ success: false });
  useEffect(() => {
    let active = true;
    async function initialize() {
      let step = "installation_id";
      let applied: number | null = null;
      try {
        const installationId = getInstallationId();
        applied = appliedMigrationCount(db);
        await migrateDatabase(db, installationId, (next) => {
          step = next;
        });
        step = "owner_setting";
        const stored = await getSetting("activeJournalOwner");
        if (!active) return;
        step = "owner_restore";
        initializeOwner(installationId, stored);
        if (__DEV__) console.debug("Local database ready", describeDatabase());
        setState({ success: true });
      } catch (error) {
        if (!active) return;
        setState({
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          diagnostics: { step, applied_migrations: applied, bundled_migrations: bundledMigrationCount },
        });
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, []);
  return state;
}
