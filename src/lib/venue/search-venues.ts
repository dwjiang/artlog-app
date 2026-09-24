import type { SQLiteDatabase } from "expo-sqlite";

import { searchTerm } from "@/lib/journal/query";
import { normalizeSearch } from "@/shared/journal/limits";

import type { VenueRow } from "./resolve";
import { onVenueMetadataChange, openVenueDb } from "./venue-db";
import { regionSearchNames } from "./venue-location";

export const MUSEUM_SEARCH_LIMIT = 30;
let version = 0;
onVenueMetadataChange(() => {
  version++;
});
const indexes = new WeakMap<SQLiteDatabase, { version: number; ready: Promise<void> }>();

export async function searchVenues(query: string, database?: SQLiteDatabase): Promise<VenueRow[]> {
  const term = searchTerm(query);
  if (!term) return [];
  const words = normalizeSearch(term).match(/[\p{L}\p{N}]+/gu);
  if (!words?.length) return [];
  const db = database ?? (await openVenueDb());
  let index = indexes.get(db);
  if (!index || index.version !== version) {
    const previous = index?.ready;
    const ready = (async () => {
      await previous;
      const regions = regionSearchNames();
      await db.execAsync(`CREATE VIRTUAL TABLE IF NOT EXISTS temp.venueSearch USING fts5(name, city, country, tokenize='unicode61 remove_diacritics 2');
        DELETE FROM temp.venueSearch;`);
      await db.runAsync(
        `INSERT INTO temp.venueSearch(rowid, name, city, country)
        SELECT rowid, name, coalesce(city, CASE region ${regions.map(() => "WHEN ? THEN ?").join(" ")} ELSE replace(region, '-', ' ') END), country FROM main.venues`,
        ...regions.flat(),
      );
    })();
    index = { version, ready };
    indexes.set(db, index);
    void ready.catch(() => {
      if (indexes.get(db)?.ready === ready) indexes.delete(db);
    });
  }
  await index.ready;
  return db.getAllAsync<VenueRow>(
    `SELECT v.* FROM main.venues v JOIN temp.venueSearch s ON v.rowid = s.rowid
    WHERE venueSearch MATCH ? ORDER BY s.rank, v.name COLLATE NOCASE, v.id LIMIT ?`,
    words.map((word) => `"${word}"*`).join(" AND "),
    MUSEUM_SEARCH_LIMIT,
  );
}
