import { File } from 'expo-file-system';
import { openDatabaseAsync } from 'expo-sqlite';

import { api } from '../../../convex/_generated/api';
import { getSetting, setSetting } from '@/db/repos/settings';
import { convex } from '@/lib/convex-client';
import { addBreadcrumb, reportError } from '@/lib/observability';
import { openVenueDb, readVenueTableMeta, STAGED_VENUE_DB_NAME, validateVenueTable, venueDbFile } from './venue-db';

export const VENUE_TABLE_CHECKED_AT = 'venueTableCheckedAt';
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TEMP_DB_NAME = 'venues.db.tmp';

export type LatestVenueTable = { version: number; rowCount: number; url: string };

export type RefreshDependencies = {
  getCheckedAt(): Promise<number | undefined>;
  setCheckedAt(at: number): Promise<void>;
  fetchLatest(): Promise<LatestVenueTable | null>;
  localVersion(): Promise<number>;
  /** Downloads and verifies a table staged for the next launch. */
  install(latest: LatestVenueTable): Promise<void>;
  now(): number;
};

export type RefreshOutcome = 'skipped' | 'current' | 'downloaded';

/** Checks `venueTable.latest` at most once a day and installs a newer table for the next launch. */
export async function refreshVenueTable(deps: RefreshDependencies): Promise<RefreshOutcome> {
  const now = deps.now();
  const checkedAt = await deps.getCheckedAt();
  if (checkedAt !== undefined && now - checkedAt < REFRESH_INTERVAL_MS) return 'skipped';
  const latest = await deps.fetchLatest();
  await deps.setCheckedAt(now);
  if (!latest || latest.version <= (await deps.localVersion())) return 'current';
  await deps.install(latest);
  return 'downloaded';
}

async function installTable(latest: LatestVenueTable): Promise<void> {
  const target = venueDbFile();
  const temp = new File(target.parentDirectory, TEMP_DB_NAME);
  if (temp.exists) temp.delete();
  await File.downloadFileAsync(latest.url, temp);
  const downloaded = await openDatabaseAsync(TEMP_DB_NAME, { useNewConnection: true });
  try {
    await validateVenueTable(downloaded);
    const meta = await readVenueTableMeta(downloaded);
    if (meta.version !== latest.version || meta.rowCount !== latest.rowCount) {
      throw new Error(`Downloaded venue table is version ${meta.version} with ${meta.rowCount} rows, expected ${latest.version} with ${latest.rowCount}`);
    }
  } finally {
    await downloaded.closeAsync();
  }
  await temp.move(new File(target.parentDirectory, STAGED_VENUE_DB_NAME), { overwrite: true });
}

export const refreshDependencies: RefreshDependencies = {
  async getCheckedAt() {
    const value = await getSetting(VENUE_TABLE_CHECKED_AT);
    return value === undefined ? undefined : Number(value);
  },
  setCheckedAt: (at) => setSetting(VENUE_TABLE_CHECKED_AT, String(at)),
  fetchLatest: () => convex.query(api.venueTable.latest, {}),
  localVersion: async () => (await readVenueTableMeta(await openVenueDb())).version,
  install: installTable,
  now: Date.now,
};

export function refreshVenueTableInBackground(): void {
  refreshVenueTable(refreshDependencies).then(
    (outcome) => {
      if (outcome === 'downloaded') addBreadcrumb('venue.table.downloaded');
      if (__DEV__) console.debug('Venue table refresh', outcome);
    },
    (error: unknown) => { reportError(error, 'venue.table.refresh', { level: 'warning' }); console.warn('Venue table refresh failed', error); },
  );
}
