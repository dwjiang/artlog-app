import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import Database from "better-sqlite3";

const mockSettings = new Map<string, string>();
const mockConnections = new Set<Database.Database>();
let mockRoot: string;
let mockBundled: string;
const mockQuery = jest.fn();
const mockSnapshot = jest.fn();
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
  convex: { query: (query: unknown, args: unknown) => (query === "snapshot" ? mockSnapshot(args) : mockQuery(args)) },
}));
jest.mock("../../../convex/_generated/api", () => ({
  api: { venueChanges: { list: "list", snapshot: "snapshot" } },
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

const deployment = process.env.EXPO_PUBLIC_CONVEX_URL;
function table(file: string, changeVersion: number, from = deployment) {
  const db = new Database(file);
  db.exec(`CREATE TABLE venues (id TEXT PRIMARY KEY, key TEXT UNIQUE, name TEXT NOT NULL, lat REAL, lng REAL, website TEXT, region TEXT, city TEXT, country TEXT, cityKey TEXT);
    CREATE TABLE meta (changeVersion INTEGER, generatedAt TEXT, deployment TEXT);
    INSERT INTO meta VALUES (${changeVersion}, 'today', '${from}');
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
  mockSnapshot.mockReset();
  mockQuery.mockResolvedValue({ venues: [], checkpoint: 1, hasMore: false });
  loadModules();
});
afterEach(() => {
  for (const db of mockConnections) db.close();
  mockConnections.clear();
  fs.rmSync(mockRoot, { recursive: true, force: true });
  process.env.EXPO_PUBLIC_CONVEX_URL = deployment;
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

it("downloads a full snapshot before changes when the bundle holds another deployment's IDs", async () => {
  mockBundled = path.join(mockRoot, "other-deployment.db");
  table(mockBundled, 42, "https://other.convex.cloud");
  const live = await venueDb.openVenueDb();
  expect(await venueDb.readVenueTableMeta(live)).toMatchObject({ changeVersion: -1, deployment });
  expect(await venueDb.nearest(live, { lat: 40, lng: -73 }, 400)).toEqual([]);

  mockSnapshot.mockResolvedValue({ venues: [gallery], checkpoint: 3, cursor: null });
  mockQuery.mockResolvedValue({ venues: [], checkpoint: 3, hasMore: false });
  await expect(refresh.refreshVenueTable(refresh.refreshDependencies)).resolves.toBe("updated");
  expect(mockSnapshot).toHaveBeenCalledWith({ cursor: null });
  expect(mockQuery).toHaveBeenCalledWith({ since: 3 });
  await live.closeAsync();
  loadModules();
  expect((await venueDb.nearest(await venueDb.openVenueDb(), gallery, 400)).map((row) => row.id)).toEqual([
    "new-gallery",
  ]);
});

it("restarts an interrupted snapshot across launches without treating partial rows as a complete table", async () => {
  mockBundled = path.join(mockRoot, "other-deployment.db");
  table(mockBundled, 42, "https://other.convex.cloud");
  mockSnapshot
    .mockResolvedValueOnce({ venues: [gallery], checkpoint: 3, cursor: "next" })
    .mockRejectedValueOnce(new Error("offline"));
  await expect(refresh.refreshVenueTable(refresh.refreshDependencies)).rejects.toThrow("offline");
  const live = await venueDb.openVenueDb();
  expect(await venueDb.readVenueTableMeta(live)).toMatchObject({ changeVersion: -1 });
  expect(await venueDb.venueNameById(gallery.id)).toBe(gallery.name);
  expect(mockSettings.has(venueDb.VENUE_TABLE_CHECKED_AT)).toBe(false);
  await live.closeAsync();
  loadModules();

  mockSnapshot.mockResolvedValue({ venues: [gallery, renamed], checkpoint: 4, cursor: null });
  mockQuery.mockResolvedValue({ venues: [], checkpoint: 4, hasMore: false });
  await expect(refresh.refreshVenueTable(refresh.refreshDependencies)).resolves.toBe("updated");
  expect(mockSnapshot).toHaveBeenLastCalledWith({ cursor: null });
  expect(await venueDb.readVenueTableMeta(await venueDb.openVenueDb())).toMatchObject({ changeVersion: 4 });
  expect(await venueDb.venueMetadataForIds([gallery.id, renamed.id])).toHaveLength(2);
});

it.each([false, true])(
  "preserves legacy journal metadata offline when the bundle belongs to another deployment: %s",
  async (otherDeployment) => {
    const live = await venueDb.openVenueDb();
    await venueDb.applyVenueMetadata(live, [gallery]);
    await live.execAsync("ALTER TABLE meta DROP COLUMN deployment");
    await live.closeAsync();
    if (otherDeployment) {
      mockBundled = path.join(mockRoot, "other-deployment.db");
      table(mockBundled, 42, "https://other.convex.cloud");
    }
    loadModules();

    expect(await venueDb.venueMetadataForIds([gallery.id])).toEqual([
      expect.objectContaining({ id: gallery.id, city: "New York", country: "US", lat: gallery.lat, lng: gallery.lng }),
    ]);
    expect(await venueDb.readVenueTableMeta(await venueDb.openVenueDb())).toMatchObject({ deployment });
    expect(await venueDb.venueNameById("museum-1" as never)).toBe(otherDeployment ? undefined : "Museum");
    expect(mockSnapshot).not.toHaveBeenCalled();
    expect(mockReportError).not.toHaveBeenCalled();
  },
);

it("replaces an installed table holding another deployment's IDs even when the asset hash matches", async () => {
  const live = await venueDb.openVenueDb();
  await venueDb.applyVenueMetadata(live, [gallery]);
  await live.runAsync("UPDATE meta SET deployment = 'https://other.convex.cloud'");
  await live.closeAsync();
  loadModules();

  const reopened = await venueDb.openVenueDb();
  expect(await venueDb.readVenueTableMeta(reopened)).toMatchObject({ changeVersion: 1, deployment });
  expect(await venueDb.venueNameById("museum-1" as never)).toBe("Museum");
  expect(await venueDb.venueNameById(gallery.id)).toBeUndefined();
  expect(mockReportError).not.toHaveBeenCalled();
});

it("names a venue from the local table for a saved work", async () => {
  expect(await venueDb.venueNameById("museum-1" as never)).toBe("Museum");
  expect(await venueDb.venueNameById("museum-none" as never)).toBeUndefined();
});

it("migrates an installed older table in place without losing journal venues or its checkpoint", async () => {
  const live = await venueDb.openVenueDb();
  await venueDb.applyVenueMetadata(live, [gallery]);
  await venueDb.applyVenueChanges(live, { venues: [renamed], checkpoint: 8, hasMore: false });
  await live.execAsync("ALTER TABLE venues DROP COLUMN excludedFromDiscovery");
  await live.closeAsync();
  loadModules();

  const reopened = await venueDb.openVenueDb();
  expect(await venueDb.readVenueTableMeta(reopened)).toMatchObject({ changeVersion: 8 });
  expect(await venueDb.venueMetadataForIds([gallery.id, renamed.id])).toEqual([
    expect.objectContaining({ id: renamed.id, name: renamed.name, excludedFromDiscovery: 0 }),
    expect.objectContaining({ id: gallery.id, name: gallery.name, excludedFromDiscovery: 0 }),
  ]);
  expect(await reopened.getAllAsync("SELECT id FROM journalVenues")).toEqual([{ id: gallery.id }]);
  expect(mockReportError).not.toHaveBeenCalled();
});

it("applies withdrawal and restoration from incremental refresh while keeping saved venue metadata accessible", async () => {
  const live = await venueDb.openVenueDb();
  expect((await searchVenues("Museum", live)).map((row) => row.id)).toEqual([renamed.id]);
  mockQuery.mockResolvedValue({ venues: [{ ...renamed, excludedFromDiscovery: true }], checkpoint: 2, hasMore: false });
  await refresh.refreshVenueTable(refresh.refreshDependencies);

  expect(await searchVenues("Museum", live)).toEqual([]);
  expect(await venueDb.nearest(live, renamed, 400)).toEqual([]);
  expect(await venueDb.venueNameById(renamed.id)).toBe(renamed.name);
  expect(await venueDb.venueCoordinates(renamed.id)).toEqual({ lat: renamed.lat, lng: renamed.lng });
  expect(await venueDb.venueMetadataForIds([renamed.id])).toEqual([
    expect.objectContaining({ id: renamed.id, excludedFromDiscovery: 1 }),
  ]);

  mockSettings.delete(venueDb.VENUE_TABLE_CHECKED_AT);
  mockQuery.mockResolvedValue({
    venues: [{ ...renamed, excludedFromDiscovery: false }],
    checkpoint: 3,
    hasMore: false,
  });
  await refresh.refreshVenueTable(refresh.refreshDependencies);
  expect((await searchVenues("Museum", live)).map((row) => row.id)).toEqual([renamed.id]);
  expect((await venueDb.nearest(live, renamed, 400)).map((row) => row.id)).toEqual([renamed.id]);
});

it("carries discovery status in a full snapshot without dropping withdrawn venues", async () => {
  mockBundled = path.join(mockRoot, "other-deployment.db");
  table(mockBundled, 42, "https://other.convex.cloud");
  mockSnapshot.mockResolvedValue({
    venues: [{ ...gallery, excludedFromDiscovery: true }, renamed],
    checkpoint: 3,
    cursor: null,
  });
  mockQuery.mockResolvedValue({ venues: [], checkpoint: 3, hasMore: false });
  await refresh.refreshVenueTable(refresh.refreshDependencies);

  const live = await venueDb.openVenueDb();
  expect(await searchVenues("Harbor", live)).toEqual([]);
  expect((await venueDb.nearest(live, gallery, 400)).map((row) => row.id)).toEqual([renamed.id]);
  expect(await venueDb.venueMetadataForIds([gallery.id])).toEqual([
    expect.objectContaining({ id: gallery.id, name: gallery.name, excludedFromDiscovery: 1 }),
  ]);
});

it("applies discovery status from journal sync and clears it when the flag is absent", async () => {
  const live = await venueDb.openVenueDb();
  await venueDb.applyVenueMetadata(live, [{ ...gallery, excludedFromDiscovery: true }]);
  expect(await searchVenues("Harbor", live)).toEqual([]);
  expect(await venueDb.venueNameById(gallery.id)).toBe(gallery.name);
  await venueDb.applyVenueMetadata(live, [gallery]);
  expect((await searchVenues("Harbor", live)).map((row) => row.id)).toEqual([gallery.id]);
});

it("filters known excluded places by normalized name and distance offline without changing retained records", async () => {
  const live = await venueDb.openVenueDb();
  await venueDb.applyVenueMetadata(live, [{ ...gallery, excludedFromDiscovery: true }]);
  const before = await venueDb.venueMetadataForIds([gallery.id]);
  mockQuery.mockClear();
  mockSnapshot.mockClear();
  const excluded = {
    name: "  ＨＡＲＢＯＲ   GALLERY ",
    lat: gallery.lat + 0.0003,
    lng: gallery.lng,
    category: "museum",
  };
  const otherBranch = { ...excluded, lat: gallery.lat + 0.002 };
  const unknown = { ...excluded, name: "New Gallery" };
  const included = { name: "Museum", lat: 40, lng: -73, category: "museum" };
  expect(await venueDb.filterExcludedPlaces(live, [excluded, otherBranch, unknown, included])).toEqual([
    otherBranch,
    unknown,
    included,
  ]);
  expect(await venueDb.venueMetadataForIds([gallery.id])).toEqual(before);
  expect(mockQuery).not.toHaveBeenCalled();
  expect(mockSnapshot).not.toHaveBeenCalled();
});

it("recognizes an excluded place across the date line and leaves an empty search untouched", async () => {
  const live = await venueDb.openVenueDb();
  await venueDb.applyVenueMetadata(live, [
    { ...gallery, name: "Island Museum", lat: 0, lng: 179.9998, excludedFromDiscovery: true },
  ]);
  expect(await venueDb.filterExcludedPlaces(live, [{ name: "Island Museum", lat: 0, lng: -179.9998 }])).toEqual([]);
  expect(await venueDb.filterExcludedPlaces(live, [])).toEqual([]);
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
  expect(mockReportError).toHaveBeenCalledWith(
    expect.objectContaining({ message: "file is not a database", code: "SQLITE_NOTADB" }),
    "venue.table.validate",
    { level: "warning" },
  );
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

it("opens the shipped production asset with art museums discoverable and excluded museums retained for history", async () => {
  mockBundled = path.resolve(__dirname, "../../..", "assets/venues.db");
  process.env.EXPO_PUBLIC_CONVEX_URL = "https://admired-goldfinch-660.convex.cloud";
  loadModules();
  const db = await venueDb.openVenueDb();
  const matches = await searchVenues("Metropolitan Museum", db);
  const met = matches.find(({ key }) => key === "wikidata:Q160236");
  expect(met).toBeDefined();
  expect(await venueDb.nearest(db, met!, 400)).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: met!.id })]),
  );
  const excluded = await db.getFirstAsync<import("./resolve").VenueRow>(
    "SELECT * FROM venues WHERE key = ?",
    "wikidata:Q964035",
  );
  expect(excluded).toMatchObject({ name: "Computer History Museum", excludedFromDiscovery: 1 });
  expect((await searchVenues("Computer History Museum", db)).map(({ id }) => id)).not.toContain(excluded!.id);
  expect((await venueDb.nearest(db, excluded!, 400)).map(({ id }) => id)).not.toContain(excluded!.id);
  expect(await venueDb.venueNameById(excluded!.id)).toBe("Computer History Museum");
  expect(await venueDb.venueCoordinates(excluded!.id)).toEqual({ lat: excluded!.lat, lng: excluded!.lng });
  expect(await venueDb.venueMetadataForIds([excluded!.id])).toEqual([excluded]);
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
      excludedFromDiscovery: true,
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
      excludedFromDiscovery: 1,
    }),
  ]);
  expect(mockSettings.get("venueTableAssetHash")).toBe("bundle");
});
