import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './schema';

/** An in-memory database with the committed migrations applied; Jest runs from the repository root. */
export function createTestDatabase() {
  const db = drizzle(new Database(':memory:'), { schema });
  migrate(db, { migrationsFolder: 'src/db/migrations' });
  return db;
}
