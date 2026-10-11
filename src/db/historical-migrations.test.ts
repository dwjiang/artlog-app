import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import type { db } from "./client";
import { migrateDatabase } from "./migrate-database";
import { findCapturePhoto, selectArtworkPhotos } from "./repos/artwork-album";
import { pendingScansQuery } from "./repos/pending-scans";
import { pendingSavedRecognition } from "./repos/saved-recognition";
import * as schema from "./schema";

let mockDb: typeof db;
jest.mock("./client", () => ({
  get db() {
    return mockDb;
  },
}));

const versions = [
  { fixture: "unowned-capture-store", timestamp: 1789093778194 },
  { fixture: "unowned-local-store", timestamp: 1789163450901 },
  { fixture: "unowned-photo-storage", timestamp: 1789163450901 },
];
const installationId = "legacy-installation";
const capturedAt = Date.UTC(2026, 8, 13, 23, 45);
const descriptors = Buffer.from([0, 3, 127, 255]);
const keypoints = Buffer.from([32, 0, 4, 64]);
let directory: string;
let sqlite: Database.Database;

async function upgrade() {
  await migrateDatabase(mockDb, installationId);
}

function open() {
  sqlite = new Database(join(directory, "artlog.db"));
  sqlite.pragma("foreign_keys = ON");
  mockDb = drizzle(sqlite, { schema }) as unknown as typeof db;
}

function seed(fixture: string, timestamp: number, accountId?: string) {
  sqlite.exec(readFileSync(join(__dirname, "test-fixtures", `${fixture}.sql`), "utf8"));
  sqlite.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
  sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('', ?)").run(timestamp);
  sqlite
    .prepare("INSERT INTO visits (localId, venueId, venueName, startedAt, endedAt) VALUES (?, ?, ?, ?, ?)")
    .run("visit", "museum", "Saved museum", capturedAt - 60_000, capturedAt + 60_000);
  sqlite
    .prepare(
      `INSERT INTO savedWorks (localId, visitLocalId, savedAt, title, artist, photoPath, cropPath, deletedAt)
       VALUES (?, 'visit', ?, ?, 'An artist', ?, ?, ?)`,
    )
    .run("saved", capturedAt, "Remembered painting", "photos/missing-original.jpg", "crops/saved.jpg", null);
  sqlite
    .prepare(
      `INSERT INTO savedWorks (localId, savedAt, title, artist, photoPath, cropPath, deletedAt)
       VALUES ('removed', ?, 'Removed painting', 'An artist', 'photos/removed.jpg', 'crops/removed.jpg', ?)`,
    )
    .run(capturedAt, capturedAt + 1);
  sqlite
    .prepare(
      `INSERT INTO pendingScans
       (localId, photoPath, cropPath, vector, descriptors, keypoints, modelVersion, capturedAt,
        status, attemptModelVersion, attempts, lastError, createdAt, labelPhotoPath, qrUrl)
       VALUES ('pending', 'photos/pending.jpg', 'crops/pending.jpg', '[0.5,1,-0.5]', ?, ?, 'old-model', ?,
         'identifying', 'old-model', 2, 'offline', ?, 'labels/pending.jpg', 'https://museum.example/label')`,
    )
    .run(descriptors, keypoints, capturedAt, capturedAt);
  sqlite
    .prepare("INSERT INTO notes (savedLocalId, text, updatedAt) VALUES ('saved', 'Private note', ?)")
    .run(capturedAt);
  sqlite.prepare("INSERT INTO settings (key, value) VALUES ('collectionView', 'visits')").run();
  if (accountId) {
    sqlite
      .prepare("INSERT INTO settings (key, value) VALUES ('collectionSync', ?)")
      .run(JSON.stringify({ accountId, deviceId: "old-device", scope: "old-scope", since: capturedAt }));
  }
  if (fixture === "unowned-photo-storage") {
    sqlite
      .prepare(
        "UPDATE savedWorks SET photoStorageId = 'remote-original', cropStorageId = 'remote-crop' WHERE localId = 'saved'",
      )
      .run();
  }
}

beforeEach(() => {
  mkdirSync(".context", { recursive: true });
  directory = mkdtempSync(".context/historical-migrations-");
  open();
});

afterEach(() => {
  jest.restoreAllMocks();
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

describe.each(versions)("upgrading $fixture", ({ fixture, timestamp }) => {
  it.each([undefined, "legacy-account"])(
    "preserves the collection and queue through reopen for account %s",
    async (accountId) => {
      seed(fixture, timestamp, accountId);
      const owner = accountId ? `account:${accountId}` : `device:${installationId}`;

      await upgrade();

      expect(sqlite.prepare("SELECT value FROM settings WHERE key = 'activeJournalOwner'").get()).toEqual({
        value: owner,
      });
      expect(sqlite.prepare("SELECT value FROM settings WHERE key = 'collectionView'").get()).toEqual({
        value: "visits",
      });
      expect(sqlite.prepare("SELECT * FROM savedWorks WHERE localId = 'saved'").get()).toMatchObject({
        owner,
        title: "Remembered painting",
        artist: "An artist",
        savedAt: capturedAt,
        visitLocalId: "visit",
        photoPath: "photos/missing-original.jpg",
        cropPath: "crops/saved.jpg",
        photoUpdatedAt: 0,
      });
      expect(sqlite.prepare("SELECT * FROM savedWorks WHERE localId = 'removed'").get()).toMatchObject({
        owner,
        deletedAt: capturedAt + 1,
      });
      expect(sqlite.prepare("SELECT * FROM visits WHERE localId = 'visit'").get()).toMatchObject({
        owner,
        venueName: "Saved museum",
        startedAt: capturedAt - 60_000,
        endedAt: capturedAt + 60_000,
        visitedOn: "2026-09-13",
        timeZone: "UTC",
        syncedAt: null,
      });
      expect(sqlite.prepare("SELECT * FROM pendingScans WHERE localId = 'pending'").get()).toMatchObject({
        owner,
        status: "identifying",
        attempts: 2,
        modelVersion: "old-model",
        lastError: "offline",
        vector: "[0.5,1,-0.5]",
        descriptors,
        keypoints,
        photoPath: "photos/pending.jpg",
        cropPath: "crops/pending.jpg",
        labelPhotoPath: "labels/pending.jpg",
        qrUrl: "https://museum.example/label",
        capturedAt,
        createdAt: capturedAt,
      });
      expect(sqlite.prepare("SELECT * FROM artworkPhotos WHERE savedLocalId = 'saved'").get()).toMatchObject({
        owner,
        path: "photos/missing-original.jpg",
        capturedAt,
        visitLocalId: "visit",
        ...(fixture === "unowned-photo-storage" ? { storageId: "remote-original" } : {}),
      });
      expect(sqlite.prepare("SELECT * FROM artworkEncounters WHERE savedLocalId = 'saved'").get()).toMatchObject({
        owner,
        visitLocalId: "visit",
        deletedAt: null,
      });
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
      const beforeRelaunch = {
        saves: sqlite.prepare("SELECT * FROM savedWorks ORDER BY localId").all(),
        scans: sqlite.prepare("SELECT * FROM pendingScans ORDER BY localId").all(),
        photos: sqlite.prepare("SELECT * FROM artworkPhotos ORDER BY localId").all(),
        encounters: sqlite.prepare("SELECT * FROM artworkEncounters ORDER BY savedLocalId").all(),
        migrations: sqlite.prepare("SELECT * FROM __drizzle_migrations ORDER BY created_at").all(),
      };
      sqlite.close();
      open();

      await upgrade();

      expect({
        saves: sqlite.prepare("SELECT * FROM savedWorks ORDER BY localId").all(),
        scans: sqlite.prepare("SELECT * FROM pendingScans ORDER BY localId").all(),
        photos: sqlite.prepare("SELECT * FROM artworkPhotos ORDER BY localId").all(),
        encounters: sqlite.prepare("SELECT * FROM artworkEncounters ORDER BY savedLocalId").all(),
        migrations: sqlite.prepare("SELECT * FROM __drizzle_migrations ORDER BY created_at").all(),
      }).toEqual(beforeRelaunch);
      expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    },
  );
});

it("restores the legacy open visit under the recovered journal owner", async () => {
  seed("unowned-local-store", 1789163450901);
  sqlite.prepare("UPDATE visits SET endedAt = NULL WHERE localId = 'visit'").run();
  sqlite.prepare("INSERT INTO settings (key, value) VALUES ('currentVisit', 'visit')").run();

  await upgrade();

  expect(
    sqlite.prepare("SELECT value FROM settings WHERE key = ?").get(`currentVisit:device:${installationId}`),
  ).toEqual({ value: "visit" });
});

it("rolls back a failed ownership conversion and retries after reopening the same database", async () => {
  seed("unowned-photo-storage", 1789163450901, "legacy-account");
  const before = {
    tables: sqlite.prepare("SELECT * FROM sqlite_master ORDER BY name").all(),
    saves: sqlite.prepare("SELECT * FROM savedWorks ORDER BY localId").all(),
    scans: sqlite.prepare("SELECT * FROM pendingScans ORDER BY localId").all(),
    settings: sqlite.prepare("SELECT * FROM settings ORDER BY key").all(),
    migrations: sqlite.prepare("SELECT * FROM __drizzle_migrations").all(),
  };
  const prepare = sqlite.prepare.bind(sqlite);
  const failure = jest.spyOn(sqlite, "prepare").mockImplementation((source: string) => {
    if (/INSERT INTO "savedWorks"/i.test(source)) throw new Error("disk I/O error");
    return prepare(source);
  });

  await expect(upgrade()).rejects.toMatchObject({ cause: expect.objectContaining({ message: "disk I/O error" }) });
  failure.mockRestore();
  sqlite.close();
  open();

  expect({
    tables: sqlite.prepare("SELECT * FROM sqlite_master ORDER BY name").all(),
    saves: sqlite.prepare("SELECT * FROM savedWorks ORDER BY localId").all(),
    scans: sqlite.prepare("SELECT * FROM pendingScans ORDER BY localId").all(),
    settings: sqlite.prepare("SELECT * FROM settings ORDER BY key").all(),
    migrations: sqlite.prepare("SELECT * FROM __drizzle_migrations").all(),
  }).toEqual(before);

  await upgrade();

  expect(sqlite.prepare("SELECT owner, title FROM savedWorks WHERE localId = 'saved'").get()).toEqual({
    owner: "account:legacy-account",
    title: "Remembered painting",
  });
  expect(sqlite.pragma("foreign_key_check")).toEqual([]);
});

it("retains an unreadable legacy account checkpoint without assigning its collection to another journal", async () => {
  seed("unowned-local-store", 1789163450901);
  sqlite.prepare("INSERT INTO settings (key, value) VALUES ('collectionSync', '{broken')").run();

  await expect(upgrade()).rejects.toBeInstanceOf(SyntaxError);

  expect(sqlite.prepare("SELECT localId, title FROM savedWorks WHERE localId = 'saved'").get()).toEqual({
    localId: "saved",
    title: "Remembered painting",
  });
  expect(sqlite.prepare("SELECT value FROM settings WHERE key = 'collectionSync'").get()).toEqual({ value: "{broken" });
  expect(sqlite.prepare("SELECT value FROM settings WHERE key = 'activeJournalOwner'").get()).toBeUndefined();
  expect(sqlite.prepare("SELECT created_at FROM __drizzle_migrations").all()).toEqual([{ created_at: 1789163450901 }]);
});

it("keeps a legacy saved capture out of the unsaved queue when its work has a different local id", async () => {
  seed("unowned-local-store", 1789163450901);
  sqlite
    .prepare("UPDATE pendingScans SET photoPath = 'photos/missing-original.jpg', cropPath = 'crops/saved.jpg'")
    .run();

  await upgrade();

  const owner = `device:${installationId}`;
  expect(pendingScansQuery(owner).all()).toEqual([]);
  expect(findCapturePhoto("pending", owner)).toMatchObject({
    savedLocalId: "saved",
    path: "photos/missing-original.jpg",
  });
});

it("preserves both legacy saves when the same capture was saved more than once", async () => {
  seed("unowned-local-store", 1789163450901);
  sqlite
    .prepare("UPDATE pendingScans SET photoPath = 'photos/missing-original.jpg', cropPath = 'crops/saved.jpg'")
    .run();
  sqlite
    .prepare(`INSERT INTO savedWorks (localId, savedAt, title, artist, photoPath, cropPath)
      SELECT 'saved-again', savedAt, 'Second saved description', artist, photoPath, cropPath
      FROM savedWorks WHERE localId = 'saved'`)
    .run();

  await upgrade();

  expect(
    sqlite.prepare("SELECT savedLocalId, path FROM artworkPhotos WHERE deletedAt IS NULL ORDER BY savedLocalId").all(),
  ).toEqual([
    { savedLocalId: "saved", path: "photos/missing-original.jpg" },
    { savedLocalId: "saved-again", path: "photos/missing-original.jpg" },
  ]);
  expect(pendingScansQuery(`device:${installationId}`).all()).toEqual([]);
  expect(sqlite.prepare("SELECT title FROM savedWorks WHERE localId = 'saved-again'").get()).toEqual({
    title: "Second saved description",
  });
});

it.each([false, true])(
  "keeps a deleted legacy capture out of the queue, including a shared live save: %s",
  async (hasLiveSave) => {
    seed("unowned-local-store", 1789163450901);
    sqlite
      .prepare(`UPDATE pendingScans SET photoPath = 'photos/removed.jpg', cropPath = 'crops/removed.jpg',
      status = 'identified', scanId = 'old-scan', reviewedAt = ?`)
      .run(capturedAt);
    if (hasLiveSave) {
      sqlite.prepare("UPDATE savedWorks SET photoPath = 'photos/removed.jpg' WHERE localId = 'saved'").run();
    }

    await upgrade();

    const owner = `device:${installationId}`;
    expect(pendingScansQuery(owner).all()).toEqual([]);
    expect(findCapturePhoto("pending", owner)).toMatchObject({
      savedLocalId: hasLiveSave ? "saved" : "removed",
      deletedAt: hasLiveSave ? null : capturedAt + 1,
    });
    expect(selectArtworkPhotos("removed", owner).all()).toEqual([]);
  },
);

it("retains a capture's album link after its photo moves, downloads and is deleted", async () => {
  seed("unowned-local-store", 1789163450901);
  sqlite
    .prepare("UPDATE pendingScans SET photoPath = 'photos/missing-original.jpg', cropPath = 'crops/saved.jpg'")
    .run();
  await upgrade();
  const owner = `device:${installationId}`;
  expect(findCapturePhoto("pending", owner)).toMatchObject({ localId: "saved", savedLocalId: "saved" });
  sqlite
    .prepare(
      "UPDATE artworkPhotos SET savedLocalId = 'removed', path = 'collection-photos/recovered.jpg' WHERE localId = 'saved'",
    )
    .run();
  expect(findCapturePhoto("pending", owner)).toMatchObject({ localId: "saved", savedLocalId: "removed" });
  sqlite.prepare("UPDATE artworkPhotos SET path = NULL, deletedAt = 3000 WHERE localId = 'saved'").run();
  sqlite.prepare("UPDATE savedWorks SET photoPath = NULL, cropPath = NULL").run();
  sqlite.close();
  open();
  await upgrade();

  expect(pendingScansQuery(owner).all()).toEqual([]);
  expect(findCapturePhoto("pending", owner)).toMatchObject({ localId: "saved", deletedAt: 3000 });
  expect(findCapturePhoto("pending", "account:other")).toBeUndefined();
});

it("retains a recovered capture's recognition upload after downloading its photo to a new path", async () => {
  seed("unowned-local-store", 1789163450901);
  sqlite
    .prepare("UPDATE pendingScans SET photoPath = 'photos/missing-original.jpg', cropPath = 'crops/saved.jpg'")
    .run();
  await upgrade();
  sqlite.prepare("UPDATE artworkPhotos SET path = 'collection-photos/recovered.jpg' WHERE localId = 'saved'").run();

  expect(pendingSavedRecognition(`device:${installationId}`)).toEqual([{ localId: "saved", sourceLocalId: "pending" }]);
  expect(pendingSavedRecognition("account:other")).toEqual([]);
});
