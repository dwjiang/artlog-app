import { Asset } from "expo-asset";
import { File, Paths } from "expo-file-system";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import type { Id } from "../../../convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { getSetting, setSetting } from "@/db/repos/settings";
import { bundledVenueAsset } from "@/lib/venue-asset";
import { filePath } from "@/lib/file-uri";
import { reportError } from "@/lib/observability";
import {
  boundingBox,
  CHOOSE_RADIUS_M,
  pickVenue,
  rankCandidates,
  type Coordinate,
  type VenueCandidate,
  type VenueResolution,
  type VenueRow,
} from "./resolve";

export const VENUE_DB_NAME = "venues.db";
export const STAGED_VENUE_DB_NAME = "venues.next.db";
const INSTALLED_ASSET_SETTING = "venueTableAssetHash";

export type VenueTableMeta = { version: number; generatedAt: string; rowCount: number };

/** The live copy stays at this path; staged tables are applied at launch in a transaction. */
export function venueDbFile(): File {
  return new File(Paths.document, "SQLite", VENUE_DB_NAME);
}

const VENUE_COLUMNS = "id, key, name, lat, lng, website, region, city, cityKey, country";

/**
 * Copies the bundled table into place on first launch and again after an app update ships a new
 * asset; a downloaded refresh is kept until then because it is newer than the asset it replaced.
 * Journal venues are read out first so the caller can carry them into the new copy: the sync
 * checkpoint has already passed them, so nothing would send them again.
 */
async function installBundledTable(
  target: File,
): Promise<{ assetKey: string; carried: VenueRow[] } | undefined> {
  const asset = Asset.fromModule(bundledVenueAsset);
  const assetKey = asset.hash ?? asset.uri;
  const reusable = target.exists && (await installedTableIsValid());
  if (reusable && (await getSetting(INSTALLED_ASSET_SETTING)) === assetKey) return undefined;
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error("The bundled venue table could not be loaded");
  const carried = reusable ? await journalVenueRows() : [];
  target.parentDirectory.create({ intermediates: true, idempotent: true });
  await new File(asset.localUri).copy(target, { overwrite: true });
  return { assetKey, carried };
}

async function installedTableIsValid(): Promise<boolean> {
  const db = await openDatabaseAsync(VENUE_DB_NAME, { useNewConnection: true });
  try {
    await validateVenueTable(db);
    return true;
  } catch (error) {
    reportError(error, "venue.table.validate", { level: "warning" });
    // The installed hash only records which bundle was copied, not that the copy landed intact.
    return false;
  } finally {
    await db.closeAsync();
  }
}

async function journalVenueRows(): Promise<VenueRow[]> {
  const db = await openDatabaseAsync(VENUE_DB_NAME, { useNewConnection: true });
  try {
    return await db.getAllAsync<VenueRow>(
      `SELECT ${VENUE_COLUMNS} FROM venues WHERE id IN (SELECT id FROM journalVenues)`,
    );
  } catch (error) {
    reportError(error, "venue.table.preserve", { level: "warning" });
    console.warn("Could not carry journal venues across the bundled table update", error);
    return [];
  } finally {
    await db.closeAsync();
  }
}

let opening: Promise<SQLiteDatabase> | undefined;

async function installStagedTable(db: SQLiteDatabase): Promise<void> {
  const staged = new File(venueDbFile().parentDirectory, STAGED_VENUE_DB_NAME);
  if (!staged.exists) return;
  await db.execAsync(
    `ATTACH DATABASE '${filePath(staged.uri).replaceAll("'", "''")}' AS downloaded`,
  );
  try {
    await validateVenueTable(db, "downloaded");
    const current = await readVenueTableMeta(db);
    const next = await db.getFirstAsync<VenueTableMeta>(
      "SELECT version, generatedAt, rowCount FROM downloaded.meta LIMIT 1",
    );
    if (!next) throw new Error("The staged venue table has no meta row");
    if (next.version > current.version) {
      await db.execAsync("BEGIN IMMEDIATE");
      try {
        // Keep confirmations made since the download, allowing published rows to supersede them.
        await db.execAsync(`DELETE FROM venues WHERE id NOT IN (SELECT id FROM journalVenues);
          INSERT OR REPLACE INTO venues (${VENUE_COLUMNS}) SELECT ${VENUE_COLUMNS} FROM downloaded.venues;
          DELETE FROM meta;
          INSERT INTO meta SELECT * FROM downloaded.meta;`);
        await db.execAsync("COMMIT");
      } catch (error) {
        await db.execAsync("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await db.execAsync("DETACH DATABASE downloaded");
    staged.delete();
  }
}

export async function validateVenueTable(
  db: SQLiteDatabase,
  schema: "main" | "downloaded" = "main",
): Promise<void> {
  await db.getAllAsync(`SELECT ${VENUE_COLUMNS} FROM ${schema}.venues LIMIT 0`);
}

/** The writable venue table for this launch; downloads wait until the next launch to replace it. */
export function openVenueDb(): Promise<SQLiteDatabase> {
  opening ??= (async () => {
    const target = venueDbFile();
    const installed = await installBundledTable(target);
    const db = await openDatabaseAsync(VENUE_DB_NAME);
    try {
      await validateVenueTable(db);
      await db.execAsync("CREATE TABLE IF NOT EXISTS journalVenues (id TEXT PRIMARY KEY)");
      if (installed) {
        for (const venue of installed.carried) await writeVenue(db, venue, "IGNORE");
        await setSetting(INSTALLED_ASSET_SETTING, installed.assetKey);
      }
      await installStagedTable(db).catch((error: unknown) => {
        reportError(error, "venue.table.install", { level: "warning" });
        console.warn("Could not install the refreshed venue table", error);
      });
      if (__DEV__) console.debug("Venue table", await readVenueTableMeta(db));
      return db;
    } catch (error) {
      await db.closeAsync();
      throw error;
    }
  })().catch((error: unknown) => {
    reportError(error, "venue.table.open");
    opening = undefined;
    throw error;
  });
  return opening;
}

export async function readVenueTableMeta(db: SQLiteDatabase): Promise<VenueTableMeta> {
  const meta = await db.getFirstAsync<VenueTableMeta>(
    "SELECT version, generatedAt, rowCount FROM main.meta LIMIT 1",
  );
  if (!meta) throw new Error("The venue table has no meta row");
  return meta;
}

/** Seeded venues within `radiusM`, nearest first (a bounding-box scan of the 42k-row table takes a few ms). */
export async function nearest(
  db: SQLiteDatabase,
  origin: Coordinate,
  radiusM: number,
): Promise<VenueCandidate[]> {
  const box = boundingBox(origin, radiusM);
  const rows = await db.getAllAsync<VenueRow>(
    `SELECT ${VENUE_COLUMNS} FROM venues WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    box.minLat,
    box.maxLat,
    box.minLng,
    box.maxLng,
  );
  return rankCandidates(rows, origin, radiusM);
}

export async function resolveVenueAt(origin: Coordinate): Promise<VenueResolution> {
  return pickVenue(await nearest(await openVenueDb(), origin, CHOOSE_RADIUS_M));
}

/** The venue an imported photo was taken at, when its EXIF position is unambiguous. */
export async function venueIdAt(origin: Coordinate): Promise<Id<"museums"> | undefined> {
  const resolution = await resolveVenueAt(origin);
  return resolution.kind === "auto" ? resolution.venue.id : undefined;
}

export type VenueMetadata = FunctionReturnType<typeof api.sync.syncJournal>["venues"][number];
const metadataListeners = new Set<() => void>();
export function onVenueMetadataChange(listener: () => void): () => void {
  metadataListeners.add(listener);
  return () => {
    metadataListeners.delete(listener);
  };
}
/** A journal venue row; `IGNORE` lets a row already published in the table win over the incoming one. */
async function writeVenue(
  db: SQLiteDatabase,
  venue: VenueMetadata | VenueRow,
  conflict: "REPLACE" | "IGNORE",
): Promise<void> {
  await db.runAsync(
    `INSERT OR ${conflict} INTO venues (${VENUE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    venue.id,
    venue.key,
    venue.name,
    venue.lat,
    venue.lng,
    venue.website ?? null,
    venue.region,
    venue.city ?? null,
    venue.cityKey ?? null,
    venue.country ?? null,
  );
  await db.runAsync("INSERT OR IGNORE INTO journalVenues (id) VALUES (?)", venue.id);
}
export async function applyVenueMetadata(db: SQLiteDatabase, rows: VenueMetadata[]): Promise<void> {
  for (const venue of rows) await writeVenue(db, venue, "REPLACE");
  if (rows.length) for (const listener of metadataListeners) listener();
}
export async function venueMetadataForIds(ids: string[]): Promise<VenueRow[]> {
  if (!ids.length) return [];
  const db = await openVenueDb();
  const unique = [...new Set(ids)],
    rows: VenueRow[] = [];
  for (let start = 0; start < unique.length; start += 50) {
    const batch = unique.slice(start, start + 50);
    rows.push(
      ...(await db.getAllAsync<VenueRow>(
        `SELECT ${VENUE_COLUMNS} FROM venues WHERE id IN (${batch.map(() => "?").join(",")})`,
        ...batch,
      )),
    );
  }
  return rows;
}

/** The display name of a venue from the local table; a saved work keeps it as text. */
export async function venueNameById(id: Id<"museums">): Promise<string | undefined> {
  const row = await (
    await openVenueDb()
  ).getFirstAsync<{ name: string }>("SELECT name FROM venues WHERE id = ?", id);
  return row?.name;
}

export async function venueCoordinates(id: Id<"museums">): Promise<Coordinate | undefined> {
  return (
    (await (
      await openVenueDb()
    ).getFirstAsync<Coordinate>("SELECT lat, lng FROM venues WHERE id = ?", id)) ?? undefined
  );
}
