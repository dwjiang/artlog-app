import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { drizzle } from "drizzle-orm/expo-sqlite";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";

import { appliedMigrationCount, bundledMigrationCount, migrateDatabase } from "./migrate-database";
import migrations from "./migrations/migrations";
import * as schema from "./schema";

jest.mock("./client", () => ({ db: undefined }));

// Keep SQLite cursors open after the first row, as Expo executeSync/getFirstSync do.
// better-sqlite3's get() resets its statement and would hide this migration lock.
function openDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  const cursors: Iterator<Record<string, unknown>>[] = [];
  const client = {
    prepareSync(source: string) {
      const statement = sqlite.prepare(source);
      function execute(params: unknown[], raw: boolean) {
        const cursor = statement.iterate(...(params as Parameters<typeof statement.iterate>));
        cursors.push(cursor);
        const first = cursor.next();
        const map = (row: Record<string, unknown>) => (raw ? Object.values(row) : row);
        return {
          getFirstSync: () => (first.done ? null : map(first.value)),
          getAllSync: () => (first.done ? [] : [map(first.value), ...Array.from(cursor, map)]),
        };
      }
      return {
        executeSync: (params: unknown[]) => execute(params, false),
        executeForRawResultSync: (params: unknown[]) => execute(params, true),
      };
    },
  };
  const database = drizzle(client as unknown as Parameters<typeof drizzle>[0], { schema });
  return {
    sqlite,
    database,
    close() {
      for (const cursor of cursors) cursor.return?.();
      sqlite.close();
    },
  };
}

it("migration diagnostics release their read cursor before upgrading past migration eight", async () => {
  const { database, sqlite, close } = openDatabase();
  try {
    await migrate(database, {
      ...migrations,
      journal: { ...migrations.journal, entries: migrations.journal.entries.slice(0, 8) },
    });
    expect(appliedMigrationCount(database)).toBe(8);
    await migrateDatabase(database, "installation");
    expect(appliedMigrationCount(database)).toBe(bundledMigrationCount);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'notes'").all()).toEqual([]);
  } finally {
    close();
  }
});

it("legacy owner lookup releases its read cursor before rebuilding tables", async () => {
  const { database, sqlite, close } = openDatabase();
  try {
    sqlite.exec(readFileSync(join(__dirname, "test-fixtures/unowned-local-store.sql"), "utf8"));
    sqlite.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
    sqlite.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('', 1789163450901)");
    sqlite
      .prepare("INSERT INTO settings (key, value) VALUES ('collectionSync', ?)")
      .run(JSON.stringify({ accountId: "account" }));
    await migrateDatabase(database, "installation");
    expect(appliedMigrationCount(database)).toBe(bundledMigrationCount);
    expect(sqlite.prepare("SELECT value FROM settings WHERE key = 'activeJournalOwner'").get()).toEqual({
      value: "account:account",
    });
  } finally {
    close();
  }
});
