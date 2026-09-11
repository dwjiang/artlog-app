import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { useEffect } from 'react';

import migrations from '../../drizzle/migrations';
import { db, describeDatabase } from './client';

export type MigrationState = { success: boolean; error?: Error };

/** Applies the committed `drizzle/` migrations once per launch; render nothing that reads the store until `success`. */
export function useDatabaseMigrations(): MigrationState {
  const state = useMigrations(db, migrations);
  useEffect(() => {
    if (__DEV__ && state.success) console.debug('Local database ready', describeDatabase());
  }, [state.success]);
  return state;
}
