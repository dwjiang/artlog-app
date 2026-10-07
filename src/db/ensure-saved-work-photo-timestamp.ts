import { sql } from "drizzle-orm";

import { db } from "./client";

export function ensureSavedWorkPhotoTimestamp(): void {
  // Drizzle does not replay applied migrations; inspect the live schema before adding a missing column.
  const columns = db.all<{ name: string }>(sql`PRAGMA table_info(savedWorks)`);
  if (columns.some((column) => column.name === "photoUpdatedAt")) return;

  db.run(sql`ALTER TABLE savedWorks ADD COLUMN photoUpdatedAt integer NOT NULL DEFAULT 0`);
}
