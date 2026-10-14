import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";

import { MUSEUM_SEARCH_LIMIT, searchVenues } from "./search-venues";

jest.mock("./venue-db", () => ({ onVenueMetadataChange: () => () => {} }));
let sql: Database.Database;
let db: SQLiteDatabase;
beforeEach(() => {
  sql = new Database(":memory:");
  sql.exec(
    "CREATE TABLE venues (id TEXT, name TEXT, city TEXT, country TEXT, region TEXT, excludedFromDiscovery INTEGER NOT NULL DEFAULT 0)",
  );
  const insert = sql.prepare("INSERT INTO venues (id, name, city, country, region) VALUES (?, ?, ?, ?, 'new-york')");
  insert.run("orsay", "Musée d’Orsay", "Paris", "FR");
  sql
    .prepare("INSERT INTO venues (id, name, city, country, region) VALUES ('met', 'The Met', NULL, NULL, 'new-york')")
    .run();
  insert.run("literal", "100% Museum", "London", "GB");
  for (let i = 0; i < 40; i++) {
    insert.run(`other-${i}`, `Museum ${i}`, "New York", "US");
  }
  db = {
    execAsync: async (query: string) => {
      sql.exec(query);
    },
    runAsync: async (query: string, ...args: unknown[]) => sql.prepare(query).run(...args),
    getAllAsync: async (query: string, ...args: unknown[]) => sql.prepare(query).all(...args),
  } as unknown as SQLiteDatabase;
});
afterEach(() => sql.close());

it("finds accent-insensitive museum names, city words, and prefixes", async () => {
  expect((await searchVenues("o", db)).map((row) => row.id)).toEqual(["orsay"]);
  expect((await searchVenues("musee par", db)).map((row) => row.id)).toEqual(["orsay"]);
  expect(await searchVenues("new york", db)).toHaveLength(MUSEUM_SEARCH_LIMIT);
  expect((await searchVenues("met new york", db)).map((row) => row.id)).toEqual(["met"]);
});

it("bounds result size and rejects invalid queries without executing SQL", async () => {
  expect(await searchVenues("museum", db)).toHaveLength(MUSEUM_SEARCH_LIMIT);
  expect(await searchVenues("x".repeat(101), db)).toEqual([]);
  expect((await searchVenues('%_ OR "*', db)).map((row) => row.id)).toEqual(["orsay"]);
});

it("hides excluded venues even when a search index predates their withdrawal", async () => {
  sql.prepare("UPDATE venues SET excludedFromDiscovery = 1 WHERE id = 'literal'").run();
  expect(await searchVenues("100", db)).toEqual([]);
  expect((await searchVenues("musee", db)).map((row) => row.id)).toEqual(["orsay"]);
  sql.prepare("UPDATE venues SET excludedFromDiscovery = 1 WHERE id = 'orsay'").run();
  expect(await searchVenues("musee", db)).toEqual([]);
});
