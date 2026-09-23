import { REFRESH_INTERVAL_MS, refreshVenueTable, type RefreshDependencies } from "./refresh";

jest.mock("./venue-db", () => ({}));
jest.mock("@/db/repos/settings", () => ({}));
jest.mock("@/lib/convex-client", () => ({}));
jest.mock("../../../convex/_generated/api", () => ({ api: {} }));
jest.mock("expo-file-system", () => ({ File: class {} }));

const latest = { version: 200, rowCount: 42_452, url: "https://storage.example/venues.db" };
let deps: jest.Mocked<RefreshDependencies>;

beforeEach(() => {
  deps = {
    getCheckedAt: jest.fn().mockResolvedValue(undefined),
    setCheckedAt: jest.fn().mockResolvedValue(undefined),
    fetchLatest: jest.fn().mockResolvedValue(latest),
    localVersion: jest.fn().mockResolvedValue(100),
    install: jest.fn().mockResolvedValue(undefined),
    now: jest.fn().mockReturnValue(1_000_000),
  };
});

it("downloads a newer published table and records the check", async () => {
  await expect(refreshVenueTable(deps)).resolves.toBe("downloaded");
  expect(deps.install).toHaveBeenCalledWith(latest);
  expect(deps.setCheckedAt).toHaveBeenCalledWith(1_000_000);
});

it("skips the network entirely within a day of the last check", async () => {
  deps.getCheckedAt.mockResolvedValue(1_000_000 - REFRESH_INTERVAL_MS + 1);
  await expect(refreshVenueTable(deps)).resolves.toBe("skipped");
  expect(deps.fetchLatest).not.toHaveBeenCalled();
  expect(deps.setCheckedAt).not.toHaveBeenCalled();
});

it("checks again once a day has passed", async () => {
  deps.getCheckedAt.mockResolvedValue(1_000_000 - REFRESH_INTERVAL_MS);
  await expect(refreshVenueTable(deps)).resolves.toBe("downloaded");
});

it.each([
  ["the same version", 200],
  ["an older version", 300],
])("keeps the local table when the published one is %s", async (_label, localVersion) => {
  deps.localVersion.mockResolvedValue(localVersion);
  await expect(refreshVenueTable(deps)).resolves.toBe("current");
  expect(deps.install).not.toHaveBeenCalled();
  expect(deps.setCheckedAt).toHaveBeenCalledWith(1_000_000);
});

it("treats an unpublished table as current", async () => {
  deps.fetchLatest.mockResolvedValue(null);
  await expect(refreshVenueTable(deps)).resolves.toBe("current");
  expect(deps.localVersion).not.toHaveBeenCalled();
});

it("leaves the check time unset when the query fails so the next launch retries", async () => {
  deps.fetchLatest.mockRejectedValue(new Error("offline"));
  await expect(refreshVenueTable(deps)).rejects.toThrow("offline");
  expect(deps.setCheckedAt).not.toHaveBeenCalled();
});
