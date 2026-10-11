import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

import * as pending from "@/db/repos/pending-scans";
import * as schema from "@/db/schema";

import type { Id } from "../../../convex/_generated/dataModel";
import { createFlusher, type FlushDependencies } from "./flush";

let mockDb: BetterSQLite3Database<typeof schema>;
jest.mock("@/db/client", () => ({
  get db() {
    return mockDb;
  },
}));

const owner = "device:test-installation";
let sqlite: Database.Database;
let directory: string;
let databasePath: string;

function open() {
  sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  mockDb = drizzle(sqlite, { schema });
}

function relaunch() {
  sqlite.close();
  open();
  migrate(mockDb, { migrationsFolder: "src/db/migrations" });
}

beforeEach(() => {
  jest.useFakeTimers();
  directory = mkdtempSync(join(process.cwd(), ".context/queue-upgrade-"));
  databasePath = join(directory, "artlog.db");
  open();
  const first = readMigrationFiles({ migrationsFolder: "src/db/migrations" })[0];
  for (const statement of first.sql) sqlite.exec(statement);
  sqlite.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
  sqlite
    .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
    .run(first.hash, first.folderMillis);
  sqlite
    .prepare(
      "INSERT INTO visits (owner, localId, venueId, venueName, visitedOn, timeZone, reflection) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(owner, "museum-visit", "museum", "Musée de l’Orangerie", "2026-06-18", "Europe/Paris", "A quiet morning");
});

afterEach(() => {
  sqlite.close();
  rmSync(directory, { recursive: true, force: true });
  jest.useRealTimers();
});

function legacyScan(
  localId: string,
  fields: { status?: string; modelVersion?: string; label?: string; attempts?: number } = {},
) {
  sqlite
    .prepare(`INSERT INTO pendingScans (
      owner, localId, photoPath, cropPath, vector, descriptors, keypoints,
      modelVersion, attemptModelVersion, venueId, visitLocalId, capturedAt,
      status, attempts, scanId, labelPhotoPath, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      owner,
      localId,
      `photos/${localId}.jpeg`,
      `crops/${localId}.jpg`,
      "[0.1,0.2,0.3]",
      Buffer.from([0, 64, 128, 255]),
      Buffer.from([8, 7, 6, 5]),
      fields.modelVersion ?? "v2",
      fields.modelVersion ?? "v2",
      "museum",
      "museum-visit",
      1_750_000_000_000,
      fields.status ?? "queued",
      fields.attempts ?? 0,
      fields.status === "identified" ? `scan-${localId}` : null,
      fields.label ?? null,
      1_750_000_000_100,
    );
}

function dependencies() {
  return {
    modelVersion: "v2",
    listFlushable: pending.listFlushable,
    listPendingLabels: pending.listPendingLabels,
    clearPendingLabel: pending.clearPendingLabel,
    recordLabelFailure: pending.recordLabelFailure,
    markIdentifying: pending.markIdentifying,
    recordFailure: pending.recordAttemptFailure,
    resetAttemptsForModel: pending.resetAttemptsForModel,
    updateFeatures: pending.updateFeatures,
    recordResult: (id, response) => pending.markIdentified(id, response.scanId),
    resolveVisitId: jest.fn(async () => "remote-museum-visit" as Id<"visits">),
    isOnline: async () => true,
    reembed: jest.fn(async (_path: string) => ({
      vector: [0.4, 0.5, 0.6],
      descriptors: new Uint8Array([255, 128, 64, 0]).buffer,
      keypoints: new Uint8Array([5, 6, 7, 8]).buffer,
    })),
    identify: jest.fn(async ({ localId }) => ({
      scanId: `scan-${localId}` as Id<"scans">,
      localId,
      capturedAt: 1_750_000_000_000,
      status: "identified" as const,
    })),
    runLabelFlow: jest.fn(async () => {}),
  } satisfies FlushDependencies;
}

it("resumes an interrupted legacy museum batch after upgrade and does not repeat completed work on relaunch", async () => {
  for (let i = 0; i < 24; i++) legacyScan(`capture-${i}`, { status: i % 3 === 0 ? "identifying" : "queued" });
  legacyScan("old-model", { modelVersion: "v1", status: "failed", attempts: 5 });
  legacyScan("finished", { status: "identified" });
  migrate(mockDb, { migrationsFolder: "src/db/migrations" });
  await pending.requeueInterrupted();
  const deps = dependencies();
  const worker = createFlusher(deps);
  try {
    await worker.start();
  } finally {
    worker.stop();
  }

  expect(deps.identify).toHaveBeenCalledTimes(25);
  expect(deps.reembed.mock.calls).toEqual([["crops/old-model.jpg"]]);
  expect(deps.identify).toHaveBeenCalledWith(
    expect.objectContaining({
      localId: "capture-0",
      vector: [0.1, 0.2, 0.3],
      descriptors: new Uint8Array([0, 64, 128, 255]).buffer,
      keypoints: new Uint8Array([8, 7, 6, 5]).buffer,
      visitId: "remote-museum-visit",
      capturedAt: 1_750_000_000_000,
    }),
  );
  relaunch();
  await pending.requeueInterrupted();
  const restarted = createFlusher(deps);
  try {
    await restarted.start();
  } finally {
    restarted.stop();
  }
  expect(deps.identify).toHaveBeenCalledTimes(25);
  expect(await pending.pendingScansQuery()).toHaveLength(26);
  expect(await pending.getPendingScan("capture-0")).toMatchObject({
    status: "identified",
    photoPath: "photos/capture-0.jpeg",
    cropPath: "crops/capture-0.jpg",
    visitLocalId: "museum-visit",
    capturedAt: 1_750_000_000_000,
    createdAt: 1_750_000_000_100,
    attempts: 0,
  });
});

it("bounds missing legacy crop and label failures while preserving retryable records and processing healthy captures", async () => {
  legacyScan("missing-crop", { modelVersion: "v1" });
  legacyScan("missing-label", { status: "identified", label: "labels/missing.jpg" });
  legacyScan("healthy");
  migrate(mockDb, { migrationsFolder: "src/db/migrations" });
  const deps = dependencies();
  deps.reembed.mockRejectedValue(new Error("Crop file does not exist"));
  deps.runLabelFlow.mockRejectedValue(new Error("Label file does not exist"));
  const worker = createFlusher(deps);
  try {
    await worker.start();
    await jest.advanceTimersByTimeAsync(60_000);
  } finally {
    worker.stop();
  }
  expect(deps.reembed).toHaveBeenCalledTimes(pending.MAX_IDENTIFY_ATTEMPTS);
  expect(deps.runLabelFlow).toHaveBeenCalledTimes(pending.MAX_LABEL_ATTEMPTS);
  expect(deps.identify.mock.calls.map(([args]) => args.localId)).toEqual(["healthy"]);

  relaunch();
  await pending.requeueInterrupted();
  const restarted = createFlusher(deps);
  try {
    await restarted.start();
    expect(deps.reembed).toHaveBeenCalledTimes(pending.MAX_IDENTIFY_ATTEMPTS);
    expect(deps.runLabelFlow).toHaveBeenCalledTimes(pending.MAX_LABEL_ATTEMPTS);
    expect(await pending.getPendingScan("missing-crop")).toMatchObject({
      status: "failed",
      attempts: 5,
      modelVersion: "v1",
      vector: [0.1, 0.2, 0.3],
      photoPath: "photos/missing-crop.jpeg",
      cropPath: "crops/missing-crop.jpg",
    });
    expect(await pending.getPendingScan("missing-label")).toMatchObject({
      status: "identified",
      scanId: "scan-missing-label",
      labelPhotoPath: "labels/missing.jpg",
      attempts: 5,
    });
    deps.reembed.mockResolvedValue({ vector: [1], descriptors: new ArrayBuffer(1), keypoints: new ArrayBuffer(1) });
    deps.runLabelFlow.mockResolvedValue(undefined);
    await pending.retryPendingScan("missing-crop");
    await pending.retryPendingLabel("missing-label");
    await restarted.flush();
    expect(await pending.getPendingScan("missing-crop")).toMatchObject({ status: "identified", attempts: 0 });
    expect(await pending.getPendingScan("missing-label")).toMatchObject({ labelPhotoPath: null, attempts: 0 });
  } finally {
    restarted.stop();
  }
});
