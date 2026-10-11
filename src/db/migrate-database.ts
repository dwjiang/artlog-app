import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";

import type { db } from "./client";
import { ensureSavedWorkPhotoTimestamp } from "./ensure-saved-work-photo-timestamp";
import migrations from "./migrations/migrations";

type Database = typeof db;

function columns(database: Pick<Database, "all">, table: string) {
  return database.all<{ name: string }>(sql`PRAGMA table_info(${sql.identifier(table)})`).map((column) => column.name);
}

function restoreUnownedDatabase(database: Database, installationId: string): void {
  const savedColumns = columns(database, "savedWorks");
  if (savedColumns.length === 0 || savedColumns.includes("owner")) return;

  // These releases reused migration 0000 with a different schema and journal timestamp.
  // Rebuild and advance that ledger entry together so interruption can always retry.
  database.transaction((tx) => {
    const ledger = tx.all<{ created_at: number }>(sql`SELECT created_at FROM __drizzle_migrations`);
    if (ledger.length !== 1 || ![1789093778194, 1789163450901].includes(ledger[0].created_at)) {
      throw new Error("Unrecognized legacy database version");
    }
    const checkpoint = tx.get<{ value: string }>(sql`SELECT value FROM settings WHERE key = 'collectionSync'`);
    let owner = `device:${installationId}`;
    if (checkpoint) {
      const value: unknown = JSON.parse(checkpoint.value);
      if (
        value
        && typeof value === "object"
        && "accountId" in value
        && typeof value.accountId === "string"
        && value.accountId.length > 0
      ) {
        owner = `account:${value.accountId}`;
      }
    }
    const tables = ["notes", "pendingScans", "savedWorks", "settings", "visits"];
    for (const table of tables) {
      tx.run(sql`ALTER TABLE ${sql.identifier(table)} RENAME TO ${sql.identifier(`legacy_${table}`)}`);
    }
    for (const statement of migrations.migrations.m0000.split("--> statement-breakpoint")) {
      tx.run(sql.raw(statement));
    }
    for (const table of ["visits", "savedWorks", "pendingScans", "notes", "settings"]) {
      const previous = columns(tx, `legacy_${table}`);
      const fields = columns(tx, table).filter((field) => previous.includes(field));
      const names = fields.map((field) => sql.identifier(field));
      const values = fields.map((field) => sql`${sql.identifier(field)}`);
      if (table !== "settings") {
        names.push(sql.identifier("owner"));
        values.push(sql`${owner}`);
      }
      if (table === "visits") {
        names.push(sql.identifier("visitedOn"), sql.identifier("timeZone"));
        // The old store has no calendar zone; retain its timestamps and use a stable UTC date.
        values.push(sql`strftime('%Y-%m-%d', startedAt / 1000.0, 'unixepoch')`, sql`'UTC'`);
      }
      tx.run(sql`INSERT INTO ${sql.identifier(table)} (${sql.join(names, sql`, `)})
        SELECT ${sql.join(values, sql`, `)} FROM ${sql.identifier(`legacy_${table}`)}`);
    }
    tx.run(sql`INSERT INTO settings (key, value) VALUES ('activeJournalOwner', ${owner})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    tx.run(sql`INSERT INTO settings (key, value)
      SELECT ${`currentVisit:${owner}`}, s.value FROM settings s
      JOIN visits v ON v.owner = ${owner} AND v.localId = s.value
      WHERE s.key = 'currentVisit' AND v.endedAt IS NULL
      ON CONFLICT(key) DO NOTHING`);
    for (const table of tables) tx.run(sql`DROP TABLE ${sql.identifier(`legacy_${table}`)}`);
    if (tx.all(sql`PRAGMA foreign_key_check`).length > 0) throw new Error("Legacy database has invalid references");
    tx.run(sql`UPDATE __drizzle_migrations SET created_at = ${migrations.journal.entries[0].when}, hash = ''`);
  });
}

export async function migrateDatabase(database: Database, installationId: string): Promise<void> {
  restoreUnownedDatabase(database, installationId);
  await migrate(database, migrations);
  ensureSavedWorkPhotoTimestamp(database);
}
