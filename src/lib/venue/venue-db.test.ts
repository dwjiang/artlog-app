import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const mockSettings = new Map<string, string>();
const mockConnections = new Set<Database.Database>();
let mockRoot: string;
let mockBundled: string;
let mockLatest: string;
const mockQuery = jest.fn();

jest.mock("@/lib/venue-asset", () => ({ bundledVenueAsset: 1 }));
jest.mock("@/db/repos/settings", () => ({
  getSetting: async (key: string) => mockSettings.get(key),
  setSetting: async (key: string, value: string) => {
    mockSettings.set(key, value);
  },
}));
jest.mock("@/lib/convex-client", () => ({
  convex: { query: () => mockQuery() },
}));
jest.mock("../../../convex/_generated/api", () => ({
  api: { venueTable: { latest: "latest" } },
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
    delete() {
      fs.unlinkSync(this.uri);
    }
    async copy(target: File) {
      await fs.promises.copyFile(this.uri, target.uri);
    }
    async move(target: File) {
      await fs.promises.rename(this.uri, target.uri);
      this.uri = target.uri;
    }
    static async downloadFileAsync(_url: string, target: File) {
      fs.copyFileSync(mockLatest, target.uri);
      return target;
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
function loadModules() {
  jest.isolateModules(() => {
    venueDb = jest.requireActual("./venue-db");
    refresh = jest.requireActual("./refresh");
  });
}

function table(file: string, version: number) {
  const db = new Database(file);
  db.exec(`CREATE TABLE venues (id TEXT PRIMARY KEY, key TEXT UNIQUE, name TEXT, lat REAL, lng REAL, website TEXT, region TEXT, city TEXT, country TEXT, cityKey TEXT);
    CREATE TABLE meta (version INTEGER, generatedAt TEXT, rowCount INTEGER);
    INSERT INTO meta VALUES (${version}, 'today', 1);
    INSERT INTO venues (id, key, name, lat, lng, website, region) VALUES ('museum-${version}', 'key-${version}', 'Museum', 40, -73, NULL, 'seeded');`);
  db.close();
}

beforeEach(() => {
  mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artlog-venue-test-"));
  mockBundled = path.join(mockRoot, "bundle.db");
  mockLatest = path.join(mockRoot, "download.db");
  table(mockBundled, 1);
  table(mockLatest, 2);
  mockSettings.clear();
  mockQuery.mockResolvedValue({
    version: 2,
    rowCount: 1,
    url: "https://example.test/venues.db",
  });
  loadModules();
});
afterEach(() => {
  for (const db of mockConnections) db.close();
  mockConnections.clear();
  fs.rmSync(mockRoot, { recursive: true, force: true });
});

it("keeps the live table writable after a refresh and carries later confirmations into the next launch", async () => {
  const live = await venueDb.openVenueDb();
  await refresh.refreshVenueTable(refresh.refreshDependencies);
  await venueDb.applyVenueMetadata(live, [
    {
      id: "new-gallery" as never,
      key: "poi:new-gallery",
      region: "US",
      name: "Gallery",
      lat: 40,
      lng: -73,
    },
  ]);
  expect(await venueDb.readVenueTableMeta(live)).toMatchObject({ version: 1 });
  expect((await venueDb.nearest(live, { lat: 40, lng: -73 }, 400)).map((row) => row.id)).toContain("new-gallery");
  await live.closeAsync();
  loadModules();
  const next = await venueDb.openVenueDb();
  expect(await venueDb.readVenueTableMeta(next)).toMatchObject({ version: 2 });
  expect((await venueDb.nearest(next, { lat: 40, lng: -73 }, 400)).map((row) => row.id).sort()).toEqual([
    "museum-2",
    "new-gallery",
  ]);
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

it("opens the shipped museum asset for nearby lookup and search", async () => {
  mockBundled = path.resolve(__dirname, "../../..", "assets/venues.db");
  const db = await venueDb.openVenueDb();
  const { searchVenues } = jest.requireActual<typeof import("./search-venues")>("./search-venues");
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

it("keeps the live table when a download fails validation", async () => {
  const live = await venueDb.openVenueDb();
  mockQuery.mockResolvedValue({
    version: 3,
    rowCount: 1,
    url: "https://example.test/venues.db",
  });
  await expect(refresh.refreshVenueTable(refresh.refreshDependencies)).rejects.toThrow("expected 3");
  await live.closeAsync();
  loadModules();
  expect(await venueDb.readVenueTableMeta(await venueDb.openVenueDb())).toMatchObject({
    version: 1,
  });
});

it("rolls back a failed staged installation without losing the live table", async () => {
  const live = await venueDb.openVenueDb();
  await refresh.refreshVenueTable(refresh.refreshDependencies);
  const staged = new Database(path.join(mockRoot, "SQLite", venueDb.STAGED_VENUE_DB_NAME));
  staged.exec("DROP TABLE venues");
  staged.close();
  await live.closeAsync();
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  loadModules();
  const reopened = await venueDb.openVenueDb();
  expect(await venueDb.readVenueTableMeta(reopened)).toMatchObject({
    version: 1,
  });
  expect((await venueDb.nearest(reopened, { lat: 40, lng: -73 }, 400)).map((row) => row.id)).toEqual(["museum-1"]);
  warn.mockRestore();
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
it("rejects downloaded assets without the journal geography columns before staging them", async () => {
  await venueDb.openVenueDb();
  const outdated = new Database(mockLatest);
  outdated.exec("ALTER TABLE venues DROP COLUMN cityKey");
  outdated.close();
  await expect(refresh.refreshVenueTable(refresh.refreshDependencies)).rejects.toThrow("cityKey");
  expect(fs.existsSync(path.join(mockRoot, "SQLite", venueDb.STAGED_VENUE_DB_NAME))).toBe(false);
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
