import type { FunctionReturnType } from "convex/server";
import { Asset } from "expo-asset";
import { File, Paths } from "expo-file-system";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import { getSetting, removeSetting, setSetting } from "@/db/repos/settings";
import { reportError } from "@/lib/observability";
import { bundledVenueAsset } from "@/lib/venue-asset";
import { normalizeVenueName } from "@/shared/venue-name";

import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  boundingBox,
  CHOOSE_RADIUS_M,
  haversineMeters,
  pickVenue,
  rankCandidates,
  type Coordinate,
  type VenueCandidate,
  type VenueResolution,
  type VenueRow,
} from "./resolve";

export const VENUE_DB_NAME = "venues.db";
const INSTALLED_ASSET_SETTING = "venueTableAssetHash";
export const VENUE_TABLE_CHECKED_AT = "venueTableCheckedAt";
const deployment = process.env.EXPO_PUBLIC_CONVEX_URL!;

export type VenueTableMeta = {
  /** Latest applied change version; -1 means a full snapshot must finish before incremental refresh. */
  changeVersion: number;
  generatedAt: string;
  /** The Convex URL of the deployment whose museum IDs the table holds. */
  deployment: string;
};

const VENUE_COLUMNS = "id, key, name, lat, lng, website, region, city, cityKey, country, excludedFromDiscovery";

/**
 * Copies the bundled table into place on first launch, again after an app update ships a new asset,
 * and when the installed table holds another deployment's IDs; the new asset's checkpoint fetches
 * again any change it predates. Journal venues are read out first so the caller can carry them into
 * the new copy: the sync checkpoint has already passed them, so nothing would send them again.
 */
async function installBundledTable(target: File): Promise<{ assetKey: string; carried: VenueRow[] } | undefined> {
  const asset = Asset.fromModule(bundledVenueAsset);
  const assetKey = asset.hash ?? asset.uri;
  const state = target.exists ? await installedTableState() : "replace";
  if (state === "current" && (await getSetting(INSTALLED_ASSET_SETTING)) === assetKey) {
    return undefined;
  }
  await asset.downloadAsync();
  if (!asset.localUri) {
    throw new Error("The bundled venue table could not be loaded");
  }
  const carried = state !== "replace" ? await journalVenueRows() : [];
  target.parentDirectory.create({ intermediates: true, idempotent: true });
  await new File(asset.localUri).copy(target, { overwrite: true });
  return { assetKey, carried };
}

async function installedTableState(): Promise<"current" | "legacy" | "replace"> {
  const db = await openDatabaseAsync(VENUE_DB_NAME, { useNewConnection: true });
  try {
    const missing = await missingVenueColumn(db);
    // Untagged bundles cannot be trusted, but journal rows came from the connected backend.
    if (missing === "meta.deployment") return "legacy";
    if (missing) return "replace";
    return (await readVenueTableMeta(db)).deployment === deployment ? "current" : "replace";
  } catch (error) {
    reportError(error, "venue.table.validate", { level: "warning" });
    // The installed hash only records which bundle was copied, not that the copy landed intact.
    return "replace";
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

async function missingVenueColumn(db: SQLiteDatabase): Promise<string | undefined> {
  for (const [table, required] of [
    ["venues", VENUE_COLUMNS.split(", ")],
    ["meta", ["changeVersion", "generatedAt", "deployment"]],
  ] as const) {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    if (table === "venues" && columns.length > 0 && !columns.some(({ name }) => name === "excludedFromDiscovery")) {
      await db.execAsync("ALTER TABLE venues ADD COLUMN excludedFromDiscovery INTEGER NOT NULL DEFAULT 0");
      columns.push({ name: "excludedFromDiscovery" });
    }
    const missing = required.find((name) => !columns.some((column) => column.name === name));
    if (missing) return `${table}.${missing}`;
  }
}

/** The writable venue table, installed from the app's bundled asset when that changes. */
export function openVenueDb(): Promise<SQLiteDatabase> {
  opening ??= (async () => {
    const target = new File(Paths.document, "SQLite", VENUE_DB_NAME);
    const installed = await installBundledTable(target);
    const db = await openDatabaseAsync(VENUE_DB_NAME);
    try {
      const missing = await missingVenueColumn(db);
      if (missing) throw new Error(`The bundled venue table is missing ${missing}`);
      await db.execAsync("CREATE TABLE IF NOT EXISTS journalVenues (id TEXT PRIMARY KEY)");
      if (installed) {
        if ((await readVenueTableMeta(db)).deployment !== deployment) {
          await db.execAsync("DELETE FROM venues");
          await db.runAsync("UPDATE meta SET changeVersion = -1, deployment = ?", deployment);
        }
        for (const venue of installed.carried) {
          await writeVenue(db, venue, "IGNORE");
        }
        await setSetting(INSTALLED_ASSET_SETTING, installed.assetKey);
        // A new asset can predate changes the replaced table had already fetched; fetch them now, not a month later.
        await removeSetting(VENUE_TABLE_CHECKED_AT);
      }
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
    "SELECT changeVersion, generatedAt, deployment FROM meta LIMIT 1",
  );
  if (!meta) throw new Error("The venue table has no meta row");
  return meta;
}

/** Seeded venues within `radiusM`, nearest first (a bounding-box scan of the 42k-row table takes a few ms). */
export async function nearest(db: SQLiteDatabase, origin: Coordinate, radiusM: number): Promise<VenueCandidate[]> {
  const box = boundingBox(origin, radiusM);
  const rows = await db.getAllAsync<VenueRow>(
    `SELECT ${VENUE_COLUMNS} FROM venues WHERE excludedFromDiscovery = 0 AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    box.minLat,
    box.maxLat,
    box.minLng,
    box.maxLng,
  );
  return rankCandidates(rows, origin, radiusM);
}

export async function filterExcludedPlaces<T extends Coordinate & { name: string }>(
  db: SQLiteDatabase,
  places: T[],
): Promise<T[]> {
  if (places.length === 0) return places;
  const bounds = places.map((place) => boundingBox(place, 100));
  // A latitude-only bound also covers matches across the date line; exact distance checks longitude.
  const excluded = await db.getAllAsync<Pick<VenueRow, "name" | "lat" | "lng">>(
    "SELECT name, lat, lng FROM venues WHERE excludedFromDiscovery = 1 AND lat BETWEEN ? AND ?",
    Math.min(...bounds.map(({ minLat }) => minLat)),
    Math.max(...bounds.map(({ maxLat }) => maxLat)),
  );
  return places.filter((place) => {
    const name = normalizeVenueName(place.name);
    return !excluded.some((venue) => normalizeVenueName(venue.name) === name && haversineMeters(place, venue) <= 100);
  });
}

// Explore takes the nearest museum's region within this distance to be the phone's own.
const REGION_RADIUS_M = 50_000;

/** The region of the discoverable museum nearest the phone, when one is close enough to stand for where it is. */
export async function regionAt(origin: Coordinate): Promise<string | undefined> {
  return (await nearest(await openVenueDb(), origin, REGION_RADIUS_M))[0]?.region;
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
const VENUE_PLACEHOLDERS = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
function venueValues(venue: VenueMetadata | VenueRow) {
  return [
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
    venue.excludedFromDiscovery ? 1 : 0,
  ];
}
/** A journal venue row; `IGNORE` lets a row already published in the table win over the incoming one. */
async function writeVenue(
  db: SQLiteDatabase,
  venue: VenueMetadata | VenueRow,
  conflict: "REPLACE" | "IGNORE",
): Promise<void> {
  await db.runAsync(
    `INSERT OR ${conflict} INTO venues (${VENUE_COLUMNS}) VALUES ${VENUE_PLACEHOLDERS}`,
    ...venueValues(venue),
  );
  await db.runAsync("INSERT OR IGNORE INTO journalVenues (id) VALUES (?)", venue.id);
}
export async function applyVenueMetadata(db: SQLiteDatabase, rows: VenueMetadata[]): Promise<void> {
  for (const venue of rows) await writeVenue(db, venue, "REPLACE");
  if (rows.length > 0) for (const listener of metadataListeners) listener();
}
export type VenueChanges = FunctionReturnType<typeof api.venueChanges.list>;
export type VenueSnapshot = FunctionReturnType<typeof api.venueChanges.snapshot>;
/** Rows are written before the checkpoint, so a page interrupted between the two is fetched and applied again. */
export async function applyVenueChanges(db: SQLiteDatabase, { venues, checkpoint }: VenueChanges): Promise<void> {
  if (venues.length > 0) {
    await db.runAsync(
      `INSERT OR REPLACE INTO venues (${VENUE_COLUMNS}) VALUES ${venues.map(() => VENUE_PLACEHOLDERS).join(", ")}`,
      ...venues.flatMap(venueValues),
    );
  }
  await db.runAsync("UPDATE meta SET changeVersion = max(changeVersion, ?)", checkpoint);
  if (venues.length > 0) for (const listener of metadataListeners) listener();
}
export async function venueMetadataForIds(ids: string[]): Promise<VenueRow[]> {
  if (ids.length === 0) return [];
  const db = await openVenueDb();
  const unique = [...new Set(ids)];
  const rows: VenueRow[] = [];
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
  const row = await (await openVenueDb()).getFirstAsync<{ name: string }>("SELECT name FROM venues WHERE id = ?", id);
  return row?.name;
}

export async function venueCoordinates(id: Id<"museums">): Promise<Coordinate | undefined> {
  return (
    (await (await openVenueDb()).getFirstAsync<Coordinate>("SELECT lat, lng FROM venues WHERE id = ?", id)) ?? undefined
  );
}
