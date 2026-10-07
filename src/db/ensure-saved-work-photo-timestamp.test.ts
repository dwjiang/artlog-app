import { sql } from "drizzle-orm";

import { getLocalOwner } from "@/lib/account/owner-store";

import { db } from "./client";
import { ensureSavedWorkPhotoTimestamp } from "./ensure-saved-work-photo-timestamp";
import { listUnsynced } from "./repos/saved-works";

jest.mock("./client", () => ({
  db: jest.requireActual("./test-db").createTestDatabase(),
}));

beforeEach(() => {
  db.run(sql`BEGIN`);
});

afterEach(() => {
  db.run(sql`ROLLBACK`);
});

it("restores journal sync when migration 0000 was applied before photoUpdatedAt was added", async () => {
  db.run(sql`ALTER TABLE savedWorks DROP COLUMN photoUpdatedAt`);
  const migrations = db.all(sql`SELECT * FROM __drizzle_migrations`);
  const owner = getLocalOwner();
  db.run(sql`INSERT INTO savedWorks (owner, localId, savedAt, title, artist, cropPath)
    VALUES (${owner}, 'work', 1, 'Test painting', 'Test artist', 'crop.jpg')`);
  db.run(sql`INSERT INTO notes (owner, savedLocalId, text, updatedAt)
    VALUES (${owner}, 'work', 'Test note', 2)`);

  await expect(listUnsynced()).rejects.toThrow("no such column: savedWorks.photoUpdatedAt");

  ensureSavedWorkPhotoTimestamp();

  await expect(listUnsynced()).resolves.toMatchObject([
    {
      work: { localId: "work", title: "Test painting", cropPath: "crop.jpg", photoUpdatedAt: 0 },
      note: "Test note",
    },
  ]);
  expect(db.all(sql`SELECT * FROM __drizzle_migrations`)).toEqual(migrations);
  expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([]);
});

it("preserves photo timestamps when the current schema is opened repeatedly", async () => {
  db.run(sql`INSERT INTO savedWorks (owner, localId, savedAt, title, artist, photoUpdatedAt)
    VALUES (${getLocalOwner()}, 'work', 1, 'Test painting', 'Test artist', 123)`);

  ensureSavedWorkPhotoTimestamp();
  ensureSavedWorkPhotoTimestamp();

  await expect(listUnsynced()).resolves.toMatchObject([{ work: { photoUpdatedAt: 123 } }]);
});

it("allows a fresh database to sync its empty collection", async () => {
  ensureSavedWorkPhotoTimestamp();

  await expect(listUnsynced()).resolves.toEqual([]);
});
