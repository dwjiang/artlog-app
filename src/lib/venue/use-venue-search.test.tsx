import { renderHook, waitFor } from "@testing-library/react-native";
import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";

import { useVenueSearch } from "./use-venue-search";

jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));
jest.mock("@/lib/venue-asset", () => ({ bundledVenueAsset: 1 }));
jest.mock("./venue-db", () => ({
  ...jest.requireActual("./venue-db"),
  openVenueDb: async () => mockDb,
}));
const mockSearchByName = jest.fn();
jest.mock("../../../modules/poi-search/src", () => ({
  getPoiSearch: () => ({ searchByName: (...args: unknown[]) => mockSearchByName(...args) }),
}));

let sql: Database.Database;
let mockDb: SQLiteDatabase;
const excluded = { name: "Computer History Museum", lat: 37.4144, lng: -122.077, category: "museum" };
const gallery = { name: "Art Gallery", lat: 37.415, lng: -122.078, category: "artGallery" };

beforeEach(() => {
  mockSearchByName.mockReset();
  sql = new Database(":memory:");
  sql.exec(
    "CREATE TABLE venues (id TEXT, name TEXT, lat REAL, lng REAL, city TEXT, country TEXT, region TEXT, excludedFromDiscovery INTEGER)",
  );
  sql
    .prepare("INSERT INTO venues (id, name, lat, lng, excludedFromDiscovery) VALUES ('hidden', ?, ?, ?, 1)")
    .run(excluded.name, excluded.lat, excluded.lng);
  mockDb = {
    execAsync: async (query: string) => {
      sql.exec(query);
    },
    runAsync: async (query: string, ...args: unknown[]) => sql.prepare(query).run(...args),
    getAllAsync: async (query: string, ...args: unknown[]) => sql.prepare(query).all(...args),
  } as unknown as SQLiteDatabase;
});
afterEach(() => sql.close());

it("keeps excluded museums out of Apple Maps fallback results while retaining other places", async () => {
  mockSearchByName.mockResolvedValue([excluded, gallery]);
  const { result } = await renderHook(() => useVenueSearch(excluded.name, 0, {}));
  await waitFor(() => expect(result.current.result).toBeDefined());
  expect(result.current.result).toMatchObject({ rows: [], places: [{ ...gallery, kind: "poi", manual: true }] });
});

it("returns an empty search when Apple Maps only finds excluded museums", async () => {
  mockSearchByName.mockResolvedValue([excluded]);
  const { result } = await renderHook(() => useVenueSearch(excluded.name, 0, {}));
  await waitFor(() => expect(result.current.result).toBeDefined());
  expect(result.current.result).toMatchObject({ rows: [], places: [] });
  expect(result.current.result?.failed).toBeUndefined();
});

it("reports a museum-table failure without exposing unchecked Apple Maps places", async () => {
  mockSearchByName.mockImplementation(async () => {
    jest.spyOn(mockDb, "getAllAsync").mockRejectedValueOnce(new Error("database unavailable"));
    return [excluded, gallery];
  });
  const { result } = await renderHook(() => useVenueSearch(excluded.name, 0, {}));
  await waitFor(() => expect(result.current.result).toBeDefined());
  expect(result.current.result).toMatchObject({ rows: [], places: [], failed: "venues" });
});
