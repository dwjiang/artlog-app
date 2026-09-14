import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useEffect } from 'react';

import migrations from './migrations/migrations';
import { db, describeDatabase } from './client';

export type MigrationState = { success: boolean; error?: Error };

// DatabaseGate prevents reads until the pending migrations have been applied.
export function useDatabaseMigrations(): MigrationState {
  const state = useMigrations(db, migrations);
  useEffect(() => {
    if (__DEV__ && state.success) console.debug('Local database ready', describeDatabase());
  }, [state.success]);
  return state;
}
