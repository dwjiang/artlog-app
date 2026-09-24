import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";

import * as schema from "./schema";

const sqlite = openDatabaseSync("artlog.db", { enableChangeListener: true });
// SQLite leaves foreign keys off per connection; the schema's references are meant to hold.
sqlite.execSync("PRAGMA foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export function describeDatabase(): {
  path: string;
  appliedMigrations: number;
} {
  const row = sqlite.getFirstSync<{ applied: number }>("SELECT count(*) AS applied FROM __drizzle_migrations");
  return { path: sqlite.databasePath, appliedMigrations: row?.applied ?? 0 };
}
