import { sql } from "drizzle-orm";

import { db } from "./client";

export function ensureSavedWorkPhotoTimestamp(): void {
  // This column was added to an already-shipped 0000 migration, which Drizzle won't replay.
  const columns = db.all<{ name: string }>(sql`PRAGMA table_info(savedWorks)`);
  if (columns.some((column) => column.name === "photoUpdatedAt")) return;

  db.run(sql`ALTER TABLE savedWorks ADD COLUMN photoUpdatedAt integer NOT NULL DEFAULT 0`);
}
