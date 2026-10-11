import { sql } from "drizzle-orm";

import { db } from "./client";

export function ensureSavedWorkPhotoTimestamp(database = db): void {
  // Drizzle does not replay applied migrations; inspect the live schema before adding a missing column.
  const columns = database.all<{ name: string }>(sql`PRAGMA table_info(savedWorks)`);
  if (columns.some((column) => column.name === "photoUpdatedAt")) return;

  database.run(sql`ALTER TABLE savedWorks ADD COLUMN photoUpdatedAt integer NOT NULL DEFAULT 0`);
}
