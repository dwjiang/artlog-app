import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import type { Id } from '../../../convex/_generated/dataModel';
import { getSetting, setSetting } from '@/db/repos/settings';
import { bundledVenueAsset } from '@/lib/venue-asset';
import { filePath } from '@/lib/file-uri';
import { boundingBox, CHOOSE_RADIUS_M, pickVenue, rankCandidates, type Coordinate, type VenueCandidate, type VenueResolution, type VenueRow } from './resolve';

export const VENUE_DB_NAME = 'venues.db';
export const STAGED_VENUE_DB_NAME = 'venues.next.db';
const INSTALLED_ASSET_SETTING = 'venueTableAssetHash';

export type VenueTableMeta = { version: number; generatedAt: string; rowCount: number };

/** The live copy stays at this path; staged tables are applied at launch in a transaction. */
export function venueDbFile(): File {
  return new File(Paths.document, 'SQLite', VENUE_DB_NAME);
}

/**
 * Copies the bundled table into place on first launch and again after an app update ships a new
 * asset; a downloaded refresh is kept until then because it is newer than the asset it replaced.
 */
async function installBundledTable(target: File): Promise<void> {
  const asset = Asset.fromModule(bundledVenueAsset);
  const assetKey = asset.hash ?? asset.uri;
  if (target.exists && (await getSetting(INSTALLED_ASSET_SETTING)) === assetKey) return;
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('The bundled venue table could not be loaded');
  target.parentDirectory.create({ intermediates: true, idempotent: true });
  new File(asset.localUri).copy(target, { overwrite: true });
  await setSetting(INSTALLED_ASSET_SETTING, assetKey);
}

let opening: Promise<SQLiteDatabase> | undefined;

async function installStagedTable(db: SQLiteDatabase): Promise<void> {
  const staged = new File(venueDbFile().parentDirectory, STAGED_VENUE_DB_NAME);
  if (!staged.exists) return;
  await db.execAsync(`ATTACH DATABASE '${filePath(staged.uri).replaceAll("'", "''")}' AS downloaded`);
  try {
    const current = await readVenueTableMeta(db);
    const next = await db.getFirstAsync<VenueTableMeta>('SELECT version, generatedAt, rowCount FROM downloaded.meta LIMIT 1');
    if (!next) throw new Error('The staged venue table has no meta row');
    if (next.version > current.version) {
      await db.execAsync('BEGIN IMMEDIATE');
      try {
        // Keep confirmations made since the download, allowing published rows to supersede them.
        await db.execAsync(`DELETE FROM venues WHERE region != 'poi';
          INSERT OR REPLACE INTO venues SELECT * FROM downloaded.venues;
          DELETE FROM meta;
          INSERT INTO meta SELECT * FROM downloaded.meta;`);
        await db.execAsync('COMMIT');
      } catch (error) {
        await db.execAsync('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await db.execAsync('DETACH DATABASE downloaded');
  }
  staged.delete();
}

/** The writable venue table for this launch; downloads wait until the next launch to replace it. */
export function openVenueDb(): Promise<SQLiteDatabase> {
  opening ??= (async () => {
    const target = venueDbFile();
    await installBundledTable(target);
    const db = await openDatabaseAsync(VENUE_DB_NAME);
    await installStagedTable(db).catch((error: unknown) => console.warn('Could not install the refreshed venue table', error));
    if (__DEV__) console.debug('Venue table', await readVenueTableMeta(db));
    return db;
  })().catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

export async function readVenueTableMeta(db: SQLiteDatabase): Promise<VenueTableMeta> {
  const meta = await db.getFirstAsync<VenueTableMeta>('SELECT version, generatedAt, rowCount FROM main.meta LIMIT 1');
  if (!meta) throw new Error('The venue table has no meta row');
  return meta;
}

/** Seeded venues within `radiusM`, nearest first (a bounding-box scan of the 42k-row table takes a few ms). */
export async function nearest(db: SQLiteDatabase, origin: Coordinate, radiusM: number): Promise<VenueCandidate[]> {
  const box = boundingBox(origin, radiusM);
  const rows = await db.getAllAsync<VenueRow>(
    'SELECT id, key, name, lat, lng, website, region, city, country FROM venues WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?',
    box.minLat, box.maxLat, box.minLng, box.maxLng,
  );
  return rankCandidates(rows, origin, radiusM);
}

export async function resolveVenueAt(origin: Coordinate): Promise<VenueResolution> {
  return pickVenue(await nearest(await openVenueDb(), origin, CHOOSE_RADIUS_M));
}

/** The venue an imported photo was taken at, when its EXIF position is unambiguous. */
export async function venueIdAt(origin: Coordinate): Promise<Id<'museums'> | undefined> {
  const resolution = await resolveVenueAt(origin);
  return resolution.kind === 'auto' ? resolution.venue.id : undefined;
}

/** A venue the user confirmed from MapKit joins the local table so the next fix resolves to it directly. */
export async function insertConfirmedVenue(
  db: SQLiteDatabase,
  venue: { id: Id<'museums'>; name: string; lat: number; lng: number; website?: string; city?: string; country?: string },
): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO venues (id, key, name, lat, lng, website, region, city, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    venue.id, `poi:${venue.id}`, venue.name, venue.lat, venue.lng, venue.website ?? null, 'poi', venue.city ?? null, venue.country ?? null,
  );
}

/** The display name of a venue from the local table; a saved work keeps it as text. */
export async function venueNameById(id: Id<'museums'>): Promise<string | undefined> {
  const row = await (await openVenueDb()).getFirstAsync<{ name: string }>('SELECT name FROM venues WHERE id = ?', id);
  return row?.name;
}

export async function venueCoordinates(id: Id<'museums'>): Promise<Coordinate | undefined> {
  return (await (await openVenueDb()).getFirstAsync<Coordinate>('SELECT lat, lng FROM venues WHERE id = ?', id)) ?? undefined;
}
