import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";

import { appliedMigrationCount, bundledMigrationCount, migrateDatabase } from "./migrate-database";
import migrations from "./migrations/migrations";
import { selectArtworkEncounters, selectArtworkPhotos } from "./repos/artwork-album";
import * as schema from "./schema";

let mockDb: ReturnType<typeof drizzle<typeof schema>>;
jest.mock("./client", () => ({
  get db() {
    return mockDb;
  },
}));

type MigrationBundle = Parameters<typeof migrate>[1];
const bundle: MigrationBundle = migrations;
const owner = "device:upgrade-installation";
const otherOwner = "account:another-person";
const connections = new Set<Database.Database>();
let directory: string;

beforeEach(() => {
  mkdirSync(".context", { recursive: true });
  directory = mkdtempSync(".context/database-upgrade-");
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const sqlite of connections) if (sqlite.open) sqlite.close();
  connections.clear();
  rmSync(directory, { recursive: true, force: true });
});

function openDatabase() {
  const sqlite = new Database(join(directory, "artlog.db"));
  sqlite.pragma("foreign_keys = ON");
  connections.add(sqlite);
  mockDb = drizzle(sqlite, { schema });
  return sqlite;
}

function through(version: number): MigrationBundle {
  return { ...bundle, journal: { entries: bundle.journal.entries.filter((entry) => entry.idx <= version) } };
}

function upgrade(config = bundle) {
  // Expo and better-sqlite3 share SQLiteSyncDialect; run the app's bundled migrator against real SQLite.
  if (config === bundle) {
    return migrateDatabase(mockDb as unknown as Parameters<typeof migrateDatabase>[0], "upgrade-installation");
  }
  return migrate(mockDb as unknown as Parameters<typeof migrate>[0], config);
}

function columns(sqlite: Database.Database, table: string) {
  return (sqlite.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);
}

function insert(sqlite: Database.Database, table: string, row: Record<string, unknown>) {
  const fields = Object.keys(row).filter((key) => columns(sqlite, table).includes(key));
  sqlite
    .prepare(`INSERT INTO ${table} (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`)
    .run(...fields.map((key) => row[key]));
}

function seedCollection(sqlite: Database.Database, version: number) {
  sqlite.transaction(() => seedCollectionRows(sqlite, version))();
}

function seedCollectionRows(sqlite: Database.Database, version: number) {
  for (const account of [owner, otherOwner]) {
    insert(sqlite, "visits", {
      owner: account,
      localId: "visit",
      venueId: "museum",
      venueName: "Musée d’Orsay",
      visitedOn: "2026-09-01",
      timeZone: "Europe/Paris",
      reflection: "The blue room\nwith Émile",
      startedAt: 100,
      endedAt: 900,
      remoteVisitId: "remote-visit",
      syncedAt: 1000,
      syncedBy: "remote-device",
      revision: 7,
      visibility: "private",
    });
    for (const [localId, photoPath, cropPath, deletedAt] of [
      ["full", "photos/full.jpg", "photos/crop.jpg", null],
      ["missing-photo", "photos/missing.jpg", "photos/missing-crop.jpg", null],
      ["crop-only", null, "photos/crop-only.jpg", null],
      ["cloud-only", null, null, null],
      ["deleted", "photos/deleted.jpg", "photos/deleted-crop.jpg", 2000],
    ] as const) {
      insert(sqlite, "savedWorks", {
        owner: account,
        localId,
        visitLocalId: "visit",
        venueId: "museum",
        venueName: "Musée d’Orsay",
        gallery: "Salle 42",
        savedAt: 700,
        title: `Water Lilies — ${localId}`,
        artist: "Claude Monet",
        date: "1906",
        medium: "Oil on canvas",
        institution: "Musée d’Orsay",
        objectId: "object",
        artworkId: "artwork",
        scanId: "scan",
        photoPath,
        cropPath,
        photoStorageId: localId === "cloud-only" ? "cloud-original" : null,
        cropStorageId: "cloud-crop",
        photoUpdatedAt: 800,
        syncedAt: 1000,
        syncedBy: "remote-device",
        revision: 9,
        deletedAt,
        cropCorners: "[[0,0],[1,0],[1,1],[0,1]]",
        cropPhotoLocalId: version >= 7 ? localId : null,
      });
      if (version >= 1) {
        insert(sqlite, "artworkPhotos", {
          owner: account,
          localId,
          savedLocalId: localId,
          kind: "full",
          capturedAt: 700,
          visitLocalId: "visit",
          caption: "A remembered detail",
          path: photoPath ?? cropPath,
          storageId: localId === "cloud-only" ? "cloud-original" : null,
          deletedAt,
          syncedAt: 1000,
          revision: 3,
        });
        insert(sqlite, "artworkEncounters", {
          owner: account,
          savedLocalId: localId,
          visitLocalId: "visit",
          note: "Worth returning to",
          deletedAt,
          syncedAt: 1000,
          revision: 2,
        });
      }
      if (columns(sqlite, "notes").length > 0) {
        insert(sqlite, "notes", { owner: account, savedLocalId: localId, text: "Saved thought", updatedAt: 800 });
      }
    }
    for (const status of schema.pendingScanStatuses) {
      insert(sqlite, "pendingScans", {
        owner: account,
        localId: status,
        photoPath: `photos/${status}-missing.jpg`,
        cropPath: `photos/${status}-crop.jpg`,
        vector: "[0.125,-0.25,0.5]",
        descriptors: Buffer.from([0, 1, 128, 255]),
        keypoints: Buffer.from([255, 128, 1, 0]),
        modelVersion: "older-model",
        attemptModelVersion: "newer-model",
        venueId: "museum",
        visitId: "remote-visit",
        visitLocalId: "visit",
        capturedAt: 700,
        labelPhotoPath: "photos/label.jpg",
        qrUrl: "https://museum.example/artwork",
        status,
        attempts: status === "failed" ? 3 : 1,
        lastError: status === "failed" ? "offline" : null,
        scanId: status === "identified" ? "remote-scan" : null,
        createdAt: 701,
        reviewedAt: 900,
        cropCorners: "[[0,0],[1,0],[1,1],[0,1]]",
      });
      if (version >= 5) {
        insert(sqlite, "offlineScanResults", {
          owner: account,
          localId: status,
          result: JSON.stringify({ outcome: "identified", title: "Water Lilies", score: 0.95 }),
        });
      }
    }
  }
  insert(sqlite, "settings", { key: "activeJournalOwner", value: owner });
  insert(sqlite, "settings", { key: "collectionSort", value: "oldest" });
}

function snapshot(sqlite: Database.Database) {
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [name, sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]),
  );
}

it.each(bundle.journal.entries.map((entry) => [entry.idx, entry.tag] as const))(
  "preserves collection and pending data upgrading schema %i (%s), including a second launch",
  async (version) => {
    let sqlite = openDatabase();
    await upgrade(through(version));
    seedCollection(sqlite, version);
    const before = snapshot(sqlite);

    await upgrade();

    for (const table of [
      "visits",
      "savedWorks",
      "pendingScans",
      "settings",
      "artworkPhotos",
      "artworkEncounters",
      "offlineScanResults",
    ]) {
      if (!before[table]) continue;
      const retained = new Set(columns(sqlite, table));
      const expected = before[table].map((row) =>
        Object.fromEntries(Object.entries(row as Record<string, unknown>).filter(([key]) => retained.has(key))),
      );
      const actual = sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
      const originalRows =
        table === "settings"
          ? actual.filter((row) => expected.some((entry) => entry.key === (row as { key: string }).key))
          : actual;
      expect(originalRows).toMatchObject(expected);
    }
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(sqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get()).toEqual({
      count: bundle.journal.entries.length,
    });

    const firstLaunch = snapshot(sqlite);
    sqlite.close();
    sqlite = openDatabase();
    await upgrade();
    expect(snapshot(sqlite)).toEqual(firstLaunch);
  },
);

it("keeps pre-album saved photographs available after an upgrade", async () => {
  const sqlite = openDatabase();
  await upgrade(through(0));
  seedCollection(sqlite, 0);

  await upgrade();

  expect(selectArtworkPhotos("full", owner).all()).toMatchObject([
    { owner, savedLocalId: "full", path: "photos/full.jpg", kind: "full", visitLocalId: "visit" },
  ]);
  expect(selectArtworkPhotos("crop-only", owner).all()).toEqual([]);
  const deferred = sqlite
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(`albumRecovery:${owner}:crop-only`) as { value: string };
  expect(JSON.parse(deferred.value)).toMatchObject({
    localId: "crop-only",
    path: "photos/crop-only.jpg",
    storageId: "cloud-crop",
  });
  expect(selectArtworkPhotos("deleted", owner).all()).toEqual([]);
});

it("preserves a cloud-only original before dropping its old storage column", async () => {
  const sqlite = openDatabase();
  await upgrade(through(0));
  seedCollection(sqlite, 0);

  await upgrade();

  expect(selectArtworkPhotos("cloud-only", owner).all()).toEqual([]);
  const deferred = sqlite
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(`albumRecovery:${owner}:cloud-only`) as { value: string };
  expect(JSON.parse(deferred.value)).toMatchObject({ localId: "cloud-only", path: null, storageId: "cloud-original" });
});

it("retains pre-album visit membership independently for each owner", async () => {
  const sqlite = openDatabase();
  await upgrade(through(0));
  seedCollection(sqlite, 0);

  await upgrade();

  for (const account of [owner, otherOwner]) {
    expect(
      selectArtworkEncounters(account)
        .all()
        .map((row) => row.savedLocalId)
        .sort(),
    ).toEqual(["cloud-only", "crop-only", "full", "missing-photo"]);
  }
});

it("repairs the historical photo-timestamp schema before reading the upgraded collection", async () => {
  let sqlite = openDatabase();
  await upgrade(through(0));
  sqlite.exec("ALTER TABLE savedWorks DROP COLUMN photoUpdatedAt");
  seedCollection(sqlite, 0);

  await upgrade();

  expect(mockDb.select().from(schema.savedWorks).all()).toHaveLength(10);
  expect(
    mockDb
      .select()
      .from(schema.savedWorks)
      .all()
      .every((row) => row.photoUpdatedAt === 0),
  ).toBe(true);
  const firstLaunch = snapshot(sqlite);
  sqlite.close();
  sqlite = openDatabase();
  await upgrade();
  expect(snapshot(sqlite)).toEqual(firstLaunch);
});

it("recovers legacy albums on installations whose original migrations are already recorded", async () => {
  const sqlite = openDatabase();
  await upgrade(through(8));
  seedCollection(sqlite, 0);

  await upgrade();

  expect(selectArtworkPhotos("full", owner).all()).toMatchObject([{ path: "photos/full.jpg" }]);
  expect(
    selectArtworkEncounters(owner)
      .all()
      .map((row) => row.savedLocalId)
      .sort(),
  ).toEqual(["cloud-only", "crop-only", "full", "missing-photo"]);
});

it.each(["deleted", "moved"])("does not restore an album photo that the user %s", async (change) => {
  const sqlite = openDatabase();
  await upgrade(through(8));
  seedCollection(sqlite, 8);
  if (change === "deleted") {
    sqlite.prepare("UPDATE artworkPhotos SET deletedAt = 3000 WHERE owner = ? AND localId = 'full'").run(owner);
  } else {
    sqlite
      .prepare("UPDATE artworkPhotos SET savedLocalId = 'crop-only' WHERE owner = ? AND localId = 'full'")
      .run(owner);
  }
  sqlite.prepare("UPDATE artworkEncounters SET deletedAt = 3000 WHERE owner = ? AND savedLocalId = 'full'").run(owner);
  const before = snapshot(sqlite);

  await upgrade();

  expect(snapshot(sqlite).artworkPhotos).toMatchObject(before.artworkPhotos);
  expect(snapshot(sqlite).artworkEncounters).toEqual(before.artworkEncounters);
  expect(selectArtworkPhotos("full", owner).all()).toEqual([]);
  expect(selectArtworkPhotos("full", otherOwner).all()).toHaveLength(1);
  expect(
    selectArtworkEncounters(owner)
      .all()
      .some((row) => row.savedLocalId === "full"),
  ).toBe(false);
});

describe.each([1, 8])("upgrading remote albums from schema %i", (version) => {
  it.each([null, 300])("does not recreate a downloaded original with deletedAt %s", async (deletedAt) => {
    const sqlite = openDatabase();
    await upgrade(through(version));
    insert(sqlite, "savedWorks", {
      owner,
      localId: "remote-work",
      savedAt: 100,
      title: "Remote artwork",
      artist: "Artist",
      cropPath: "collection-photos/crop.jpg",
      cropStorageId: "cloud-crop",
      syncedAt: 200,
    });
    insert(sqlite, "artworkPhotos", {
      owner,
      localId: "original-capture",
      savedLocalId: "remote-work",
      kind: "full",
      capturedAt: 100,
      path: deletedAt ? null : "collection-photos/original.jpg",
      storageId: "cloud-original",
      syncedAt: 200,
      deletedAt,
    });
    const before = snapshot(sqlite).artworkPhotos;

    await upgrade();

    expect(snapshot(sqlite).artworkPhotos).toMatchObject(before);
    expect(snapshot(sqlite).artworkPhotos).toHaveLength(1);
  });
});

it("keeps a remote crop linked to its source after the source photo moves to another artwork", async () => {
  const sqlite = openDatabase();
  await upgrade(through(8));
  for (const localId of ["source", "target"]) {
    insert(sqlite, "savedWorks", {
      owner,
      localId,
      savedAt: 100,
      title: localId,
      artist: "Artist",
      ...(localId === "source" ? { cropStorageId: "cloud-crop", cropPhotoLocalId: "moved-photo" } : {}),
    });
  }
  insert(sqlite, "artworkPhotos", {
    owner,
    localId: "moved-photo",
    savedLocalId: "target",
    kind: "detail",
    capturedAt: 200,
    storageId: "cloud-original",
    syncedAt: 300,
  });

  await upgrade();

  expect(selectArtworkPhotos("source", owner).all()).toEqual([]);
  expect(selectArtworkPhotos("target", owner).all()).toHaveLength(1);
});

it("preserves UUID capture identifiers when promoting a saved photograph into its album", async () => {
  const sqlite = openDatabase();
  await upgrade(through(0));
  const localId = "d9fd4d5c-4cce-47d5-a793-8840d468ecb0";
  insert(sqlite, "savedWorks", {
    owner,
    localId,
    title: "Water Lilies",
    artist: "Monet",
    savedAt: 700,
    photoPath: "photos/uuid.jpg",
    cropPath: "photos/uuid-crop.jpg",
  });

  await upgrade();

  expect(selectArtworkPhotos(localId, owner).all()).toMatchObject([{ localId, savedLocalId: localId }]);
});

it.each([
  "CREATE TABLE `artworkPhotos`",
  "ALTER TABLE `savedWorks` DROP COLUMN `photoStorageId`",
  "ALTER TABLE `pendingScans` ADD `cropCorners`",
  "DROP TABLE `notes`",
  "DELETE FROM `artworkPhotos`",
])("rolls back %s and retries safely after reopening", async (interruptedSql) => {
  let sqlite = openDatabase();
  await upgrade(through(0));
  seedCollection(sqlite, 0);
  const before = snapshot(sqlite);
  const originalPrepare = sqlite.prepare.bind(sqlite);
  let interrupted = false;
  jest.spyOn(sqlite, "prepare").mockImplementation((query) => {
    const prepared = originalPrepare(query);
    if (!interrupted && query.includes(interruptedSql)) {
      const originalRun = prepared.run.bind(prepared);
      jest.spyOn(prepared, "run").mockImplementation((...parameters) => {
        originalRun(...parameters);
        interrupted = true;
        throw new Error("injected migration interruption");
      });
    }
    return prepared;
  });

  await expect(upgrade()).rejects.toMatchObject({ cause: new Error("injected migration interruption") });
  expect(interrupted).toBe(true);
  expect(snapshot(sqlite)).toEqual(before);
  sqlite.close();
  sqlite = openDatabase();
  expect(snapshot(sqlite)).toEqual(before);
  await upgrade();
  expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  expect(sqlite.prepare("SELECT count(*) AS count FROM savedWorks").get()).toEqual({ count: 10 });
});

it("recovers the journal and collection after the process exits during a migration", async () => {
  let sqlite = openDatabase();
  await upgrade(through(0));
  seedCollection(sqlite, 0);
  const before = snapshot(sqlite);
  sqlite.close();
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      `
    const Database = require('better-sqlite3');
    const { drizzle } = require('drizzle-orm/better-sqlite3');
    const { migrate } = require('drizzle-orm/expo-sqlite/migrator');
    const sqlite = new Database(process.argv[1]);
    sqlite.pragma('foreign_keys = ON');
    const prepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (query) => {
      const statement = prepare(query);
      if (query.includes('DROP COLUMN') && query.includes('photoStorageId')) {
        const run = statement.run.bind(statement);
        statement.run = (...parameters) => { run(...parameters); process.exit(86); };
      }
      return statement;
    };
    migrate(drizzle(sqlite), JSON.parse(process.argv[2])).catch(() => process.exit(1));
  `,
      join(directory, "artlog.db"),
      JSON.stringify(bundle),
    ],
    { encoding: "utf8" },
  );
  expect(child.stderr).toBe("");
  expect(child.status).toBe(86);

  sqlite = openDatabase();
  expect(snapshot(sqlite)).toEqual(before);
  await upgrade();
  expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
  expect(sqlite.prepare("SELECT count(*) AS count FROM pendingScans").get()).toEqual({ count: 8 });
});

it("recovers an original alongside unrelated detail and label photos", async () => {
  const sqlite = openDatabase();
  await upgrade(through(8));
  insert(sqlite, "savedWorks", {
    owner,
    localId: "legacy",
    savedAt: 100,
    title: "Legacy painting",
    artist: "Artist",
    photoPath: "photos/original.jpg",
    cropPath: "crops/original.jpg",
  });
  for (const kind of ["detail", "label"]) {
    insert(sqlite, "artworkPhotos", {
      owner,
      localId: kind,
      savedLocalId: "legacy",
      kind,
      capturedAt: 200,
      path: `artwork-photos/${kind}.jpg`,
    });
  }

  await upgrade();

  expect(
    selectArtworkPhotos("legacy", owner)
      .all()
      .map((photo) => photo.path),
  ).toEqual(["photos/original.jpg", "artwork-photos/detail.jpg", "artwork-photos/label.jpg"]);
});

it.each([0, 8])(
  "recovers the same album identity on account devices with and without a capture at schema %i",
  async (version) => {
    const sqlite = openDatabase();
    await upgrade(through(version));
    for (const account of [owner, otherOwner]) {
      insert(sqlite, "savedWorks", {
        owner: account,
        localId: "legacy",
        savedAt: 100,
        title: "Legacy painting",
        artist: "Artist",
        photoPath: "photos/original.jpg",
        cropPath: "crops/original.jpg",
      });
    }
    insert(sqlite, "pendingScans", {
      owner,
      localId: "capture",
      photoPath: "photos/original.jpg",
      cropPath: "crops/original.jpg",
      vector: "[]",
      descriptors: Buffer.from([0]),
      keypoints: Buffer.from([0]),
      modelVersion: "old",
      attemptModelVersion: "old",
      capturedAt: 100,
      createdAt: 100,
    });

    await upgrade();

    expect(
      selectArtworkPhotos("legacy", owner)
        .all()
        .map((photo) => photo.localId),
    ).toEqual(["legacy"]);
    expect(
      selectArtworkPhotos("legacy", otherOwner)
        .all()
        .map((photo) => photo.localId),
    ).toEqual(["legacy"]);
  },
);

it("names each startup step and counts applied migrations, so a failed launch shows which migration broke", async () => {
  openDatabase();
  const database = mockDb as unknown as Parameters<typeof migrateDatabase>[0];
  expect(appliedMigrationCount(database)).toBeNull();
  const steps: string[] = [];
  await migrateDatabase(database, "upgrade-installation", (step) => steps.push(step));
  expect(steps).toEqual(["legacy_restore", "migrate", "photo_timestamp"]);
  expect(appliedMigrationCount(database)).toBe(bundledMigrationCount);
});
