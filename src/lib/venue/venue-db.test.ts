import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import Database from "better-sqlite3";

const mockSettings = new Map<string, string>();
const mockConnections = new Set<Database.Database>();
let mockRoot: string;
let mockBundled: string;
const mockQuery = jest.fn();
const mockReportError = jest.fn();

jest.mock("@/lib/observability", () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
  addBreadcrumb: jest.fn(),
}));

jest.mock("@/lib/venue-asset", () => ({ bundledVenueAsset: 1 }));
jest.mock("@/db/repos/settings", () => ({
  getSetting: async (key: string) => mockSettings.get(key),
  setSetting: async (key: string, value: string) => {
    mockSettings.set(key, value);
  },
  removeSetting: async (key: string) => {
    mockSettings.delete(key);
  },
}));
jest.mock("@/lib/convex-client", () => ({
  convex: { query: (_query: unknown, args: unknown) => mockQuery(args) },
}));
jest.mock("../../../convex/_generated/api", () => ({
  api: { venueChanges: { list: "list" } },
}));
jest.mock("expo-asset", () => ({
  Asset: {
    fromModule: () => ({
      hash: "bundle",
      localUri: mockBundled,
      downloadAsync: async () => {},
    }),
  },
}));
jest.mock("expo-file-system", () => {
  const fs: typeof import("node:fs") = jest.requireActual("node:fs");
  const path: typeof import("node:path") = jest.requireActual("node:path");
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = path.join(...parts.map((part) => (typeof part === "string" ? part : part.uri)));
    }
    get exists() {
      return fs.existsSync(this.uri);
    }
    get parentDirectory() {
      const uri = path.dirname(this.uri);
      return { uri, create: () => fs.mkdirSync(uri, { recursive: true }) };
    }
    async copy(target: File) {
      await fs.promises.copyFile(this.uri, target.uri);
    }
  }
  return {
    File,
    Paths: {
      get document() {
        return mockRoot;
      },
    },
  };
});
jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: async (name: string) => {
    const Database = jest.requireActual("better-sqlite3");
    const path = jest.requireActual("node:path");
    const db: Database.Database = new Database(path.join(mockRoot, "SQLite", name));
    mockConnections.add(db);
    return {
      execAsync: async (sql: string) => {
        db.exec(sql);
      },
      getFirstAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).get(...params),
      getAllAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).all(...params),
      runAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).run(...params),
      closeAsync: async () => {
        db.close();
        mockConnections.delete(db);
      },
    };
  },
}));

let venueDb: typeof import("./venue-db");
let refresh: typeof import("./refresh");
let searchVenues: typeof import("./search-venues").searchVenues;
function loadModules() {
  jest.isolateModules(() => {
    venueDb = jest.requireActual("./venue-db");
    refresh = jest.requireActual("./refresh");
    searchVenues = jest.requireActual<typeof import("./search-venues")>("./search-venues").searchVenues;
  });
}

function table(file: string, changeVersion: number) {
  const db = new Database(file);
  db.exec(`CREATE TABLE venues (id TEXT PRIMARY KEY, key TEXT UNIQUE, name TEXT NOT NULL, lat REAL, lng REAL, website TEXT, region TEXT, city TEXT, country TEXT, cityKey TEXT);
    CREATE TABLE meta (changeVersion INTEGER, generatedAt TEXT);
    INSERT INTO meta VALUES (${changeVersion}, 'today');
    INSERT INTO venues (id, key, name, lat, lng, website, region) VALUES ('museum-1', 'key-1', 'Museum', 40, -73, NULL, 'seeded');`);
  db.close();
}

const gallery = {
  id: "new-gallery" as never,
  key: "poi:new-gallery",
  region: "US",
  name: "Harbor Gallery",
  lat: 40.001,
  lng: -73,
  city: "New York",
  cityKey: "wikidata:Q60",
  country: "US",
};
const renamed = { id: "museum-1" as never, key: "key-1", region: "seeded", name: "Renamed Museum", lat: 40, lng: -73 };

beforeEach(() => {
  mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artlog-venue-test-"));
  mockBundled = path.join(mockRoot, "bundle.db");
  table(mockBundled, 1);
  mockSettings.clear();
  mockReportError.mockClear();
  mockQuery.mockResolvedValue({ venues: [], checkpoint: 1, hasMore: false });
  loadModules();
});
afterEach(() => {
  for (const db of mockConnections) db.close();
  mockConnections.clear();
  fs.rmSync(mockRoot, { recursive: true, force: true });
});

it("applies changed and new venues to the live table, searchable at once and kept across launches", async () => {
  const live = await venueDb.openVenueDb();
  expect(await searchVenues("Harbor", live)).toEqual([]);
  mockQuery.mockResolvedValue({ venues: [renamed, gallery], checkpoint: 7, hasMore: false });

  await expect(refresh.refreshVenueTable(refresh.refreshDependencies)).resolves.toBe("updated");
  expect(mockQuery).toHaveBeenCalledWith({ since: 1 });
  expect((await searchVenues("Harbor", live)).map((row) => row.id)).toEqual(["new-gallery"]);
  expect(await venueDb.venueNameById("museum-1" as never)).toBe("Renamed Museum");

  await live.closeAsync();
  loadModules();
  const next = await venueDb.openVenueDb();
  expect(await venueDb.readVenueTableMeta(next)).toMatchObject({ changeVersion: 7 });
  expect(await venueDb.venueMetadataForIds(["new-gallery"])).toEqual([
    expect.objectContaining({ name: "Harbor Gallery", city: "New York", country: "US" }),
  ]);
});

it("keeps the pages applied before a failure and resumes from their checkpoint", async () => {
  const live = await venueDb.openVenueDb();
  mockQuery
    .mockResolvedValueOnce({ venues: [gallery], checkpoint: 4, hasMore: true })
    .mockRejectedValueOnce(new Error("offline"));
  await expect(refresh.refreshVenueTable(refresh.refreshDependencies)).rejects.toThrow("offline");
  expect(await venueDb.readVenueTableMeta(live)).toMatchObject({ changeVersion: 4 });
  expect(await venueDb.venueNameById("new-gallery" as never)).toBe("Harbor Gallery");

  mockQuery.mockResolvedValueOnce({ venues: [renamed], checkpoint: 5, hasMore: false });
  await expect(refresh.refreshVenueTable(refresh.refreshDependencies)).resolves.toBe("updated");
  expect(mockQuery).toHaveBeenLastCalledWith({ since: 4 });
  expect(await venueDb.readVenueTableMeta(live)).toMatchObject({ changeVersion: 5 });
});

it("leaves the rows and checkpoint unchanged when a page cannot be written", async () => {
  const live = await venueDb.openVenueDb();
  mockQuery.mockResolvedValue({ venues: [gallery, { ...renamed, name: null }], checkpoint: 9, hasMore: false });
  await expect(refresh.refreshVenueTable(refresh.refreshDependencies)).rejects.toThrow("NOT NULL");
  expect(await venueDb.readVenueTableMeta(live)).toMatchObject({ changeVersion: 1 });
  expect(await venueDb.venueNameById("new-gallery" as never)).toBeUndefined();
});

it("names a venue from the local table for a saved work", async () => {
  expect(await venueDb.venueNameById("museum-1" as never)).toBe("Museum");
  expect(await venueDb.venueNameById("museum-none" as never)).toBeUndefined();
});

it.each(["city", "country", "cityKey"])(
  "replaces an installed table missing %s even when the asset hash matches",
  async (column) => {
    const live = await venueDb.openVenueDb();
    await live.execAsync(`ALTER TABLE venues DROP COLUMN ${column}`);
    await live.closeAsync();
    loadModules();

    const reopened = await venueDb.openVenueDb();
    expect(mockReportError).not.toHaveBeenCalled();
    expect(await venueDb.nearest(reopened, { lat: 40, lng: -73 }, 400)).toEqual([
      expect.objectContaining({
        id: "museum-1",
        city: null,
        country: null,
        cityKey: null,
      }),
    ]);
  },
);

it("replaces an installed table from before change versions even when the asset hash matches", async () => {
  const live = await venueDb.openVenueDb();
  await live.execAsync("ALTER TABLE meta RENAME COLUMN changeVersion TO version");
  await live.closeAsync();
  loadModules();
  expect(await venueDb.readVenueTableMeta(await venueDb.openVenueDb())).toMatchObject({ changeVersion: 1 });
  expect(mockReportError).not.toHaveBeenCalled();
});

it("reports a corrupt installed database and recovers using the bundled table", async () => {
  const live = await venueDb.openVenueDb();
  await live.closeAsync();
  fs.writeFileSync(path.join(mockRoot, "SQLite", venueDb.VENUE_DB_NAME), "not a SQLite database");
  loadModules();
  expect(await venueDb.readVenueTableMeta(await venueDb.openVenueDb())).toMatchObject({ changeVersion: 1 });
  expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), "venue.table.validate", { level: "warning" });
});

it("drops fetched changes with a replaced bundled table and fetches them again on its first launch", async () => {
  const live = await venueDb.openVenueDb();
  mockQuery.mockResolvedValue({ venues: [gallery], checkpoint: 7, hasMore: false });
  await refresh.refreshVenueTable(refresh.refreshDependencies);
  await live.closeAsync();
  mockSettings.set("venueTableAssetHash", "previous-bundle");
  loadModules();

  const next = await venueDb.openVenueDb();
  expect(await venueDb.readVenueTableMeta(next)).toMatchObject({ changeVersion: 1 });
  expect(await venueDb.venueNameById("new-gallery" as never)).toBeUndefined();
  await expect(refresh.refreshVenueTable(refresh.refreshDependencies)).resolves.toBe("updated");
  expect(mockQuery).toHaveBeenLastCalledWith({ since: 1 });
  expect(await venueDb.venueNameById("new-gallery" as never)).toBe("Harbor Gallery");
});

it("opens the shipped museum asset for nearby lookup and search", async () => {
  mockBundled = path.resolve(__dirname, "../../..", "assets/venues.db");
  const db = await venueDb.openVenueDb();
  const matches = await searchVenues("Metropolitan Museum", db);
  expect(matches.length).toBeGreaterThan(0);
  expect(await venueDb.nearest(db, matches[0], 400)).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: matches[0].id })]),
  );
});

it("rejects an invalid bundle without marking it installed and retries after it is corrected", async () => {
  const outdated = new Database(mockBundled);
  outdated.exec("ALTER TABLE venues DROP COLUMN city");
  outdated.close();
  await expect(venueDb.openVenueDb()).rejects.toThrow("city");
  expect(mockSettings.has("venueTableAssetHash")).toBe(false);
  expect(mockConnections.size).toBe(0);

  const corrected = new Database(mockBundled);
  corrected.exec("ALTER TABLE venues ADD COLUMN city TEXT");
  corrected.close();
  const db = await venueDb.openVenueDb();
  expect(await venueDb.nearest(db, { lat: 40, lng: -73 }, 400)).toHaveLength(1);
  expect(mockSettings.get("venueTableAssetHash")).toBe("bundle");
});

it("round-trips canonical geography and clears missing metadata", async () => {
  const db = await venueDb.openVenueDb();
  const venue = {
    id: "museum-1" as never,
    key: "wikidata:Q1",
    name: "Museum",
    lat: 40,
    lng: -73,
    region: "US",
    city: "New York",
    cityKey: "wikidata:Q60",
    country: "US",
  };
  await venueDb.applyVenueMetadata(db, [venue]);
  expect((await venueDb.venueMetadataForIds([venue.id]))[0]).toMatchObject({
    name: "Museum",
    cityKey: "wikidata:Q60",
    city: "New York",
    country: "US",
  });
  await venueDb.applyVenueMetadata(db, [{ ...venue, city: undefined, country: undefined, cityKey: undefined }]);
  expect((await venueDb.venueMetadataForIds([venue.id]))[0]).toMatchObject({
    city: null,
    country: null,
    cityKey: null,
  });
});

it("carries journal venues across a new bundled asset and lets published rows supersede them", async () => {
  const live = await venueDb.openVenueDb();
  await venueDb.applyVenueMetadata(live, [
    {
      id: "poi-1" as never,
      key: "poi:1",
      region: "US",
      name: "Gallery",
      lat: 40,
      lng: -73,
      city: "New York",
      cityKey: "wikidata:Q60",
      country: "US",
    },
    {
      id: "museum-1" as never,
      key: "key-1",
      region: "seeded",
      name: "Renamed",
      lat: 40,
      lng: -73,
      city: "Paris",
      cityKey: "wikidata:Q90",
      country: "FR",
    },
  ]);
  await live.closeAsync();
  mockSettings.set("venueTableAssetHash", "previous-bundle");
  loadModules();
  await venueDb.openVenueDb();
  expect(await venueDb.venueMetadataForIds(["poi-1", "museum-1"])).toEqual([
    expect.objectContaining({
      id: "museum-1",
      name: "Museum",
      city: null,
      cityKey: null,
    }),
    expect.objectContaining({
      id: "poi-1",
      name: "Gallery",
      city: "New York",
      cityKey: "wikidata:Q60",
      country: "US",
    }),
  ]);
  expect(mockSettings.get("venueTableAssetHash")).toBe("bundle");
});
