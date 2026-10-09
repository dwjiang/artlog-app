import { refreshVenueTable, type RefreshDependencies } from "./refresh";
import type { VenueChanges } from "./venue-db";

jest.mock("./venue-db", () => ({}));
jest.mock("@/db/repos/settings", () => ({}));
jest.mock("@/lib/convex-client", () => ({}));
jest.mock("../../../convex/_generated/api", () => ({ api: {} }));

const gallery = { id: "gallery" as never, key: "poi:gallery", name: "Gallery", lat: 40, lng: -73, region: "US" };
function page(checkpoint: number, hasMore = false, venues = [gallery]): VenueChanges {
  return { venues, checkpoint, hasMore };
}
const DAY_MS = 24 * 60 * 60 * 1000;
let deps: jest.Mocked<RefreshDependencies>;

beforeEach(() => {
  deps = {
    getCheckedAt: jest.fn().mockResolvedValue(undefined),
    setCheckedAt: jest.fn().mockResolvedValue(undefined),
    localChangeVersion: jest.fn().mockResolvedValue(100),
    fetchChanges: jest.fn().mockResolvedValue(page(101)),
    fetchSnapshot: jest.fn(),
    applyChanges: jest.fn().mockResolvedValue(undefined),
    now: jest.fn().mockReturnValue(1_000_000),
  };
});

it("downloads every snapshot page and catches up from the first page's change version", async () => {
  deps.localChangeVersion.mockResolvedValue(-1);
  deps.fetchSnapshot
    .mockResolvedValueOnce({ venues: [gallery], checkpoint: 100, cursor: "next" })
    .mockResolvedValueOnce({ venues: [], checkpoint: 101, cursor: null });
  await expect(refreshVenueTable(deps)).resolves.toBe("updated");
  expect(deps.fetchSnapshot.mock.calls).toEqual([[null], ["next"]]);
  expect(deps.fetchChanges).toHaveBeenCalledWith(100);
  expect(deps.applyChanges.mock.calls).toEqual([[page(-1, true)], [page(100, false, [])], [page(101)]]);
});

it("does not complete a snapshot when its cursor fails to advance", async () => {
  deps.localChangeVersion.mockResolvedValue(-1);
  deps.fetchSnapshot.mockResolvedValue({ venues: [gallery], checkpoint: 100, cursor: "same" });
  await expect(refreshVenueTable(deps)).rejects.toThrow("snapshot did not advance");
  expect(deps.fetchChanges).not.toHaveBeenCalled();
  expect(deps.setCheckedAt).not.toHaveBeenCalled();
});

it("applies venues changed since the local checkpoint and records the check", async () => {
  await expect(refreshVenueTable(deps)).resolves.toBe("updated");
  expect(deps.fetchChanges).toHaveBeenCalledWith(100);
  expect(deps.applyChanges).toHaveBeenCalledWith(page(101));
  expect(deps.setCheckedAt).toHaveBeenCalledWith(1_000_000);
});

it("follows pages from each checkpoint until the server has no more", async () => {
  deps.fetchChanges.mockResolvedValueOnce(page(600, true)).mockResolvedValueOnce(page(650));
  await expect(refreshVenueTable(deps)).resolves.toBe("updated");
  expect(deps.fetchChanges.mock.calls).toEqual([[100], [600]]);
  expect(deps.applyChanges).toHaveBeenCalledTimes(2);
});

it("skips the network entirely within 30 days of the last check", async () => {
  deps.getCheckedAt.mockResolvedValue(1_000_000 - 30 * DAY_MS + 1);
  await expect(refreshVenueTable(deps)).resolves.toBe("skipped");
  expect(deps.fetchChanges).not.toHaveBeenCalled();
  expect(deps.setCheckedAt).not.toHaveBeenCalled();
});

it("checks again once 30 days have passed", async () => {
  deps.getCheckedAt.mockResolvedValue(1_000_000 - 30 * DAY_MS);
  await expect(refreshVenueTable(deps)).resolves.toBe("updated");
});

it("reports a current table when nothing changed", async () => {
  deps.fetchChanges.mockResolvedValue(page(100, false, []));
  await expect(refreshVenueTable(deps)).resolves.toBe("current");
  expect(deps.setCheckedAt).toHaveBeenCalledWith(1_000_000);
});

it("stops instead of looping when a page claims more without advancing", async () => {
  deps.fetchChanges.mockResolvedValue(page(100, true));
  await expect(refreshVenueTable(deps)).rejects.toThrow("did not advance past 100");
  expect(deps.setCheckedAt).not.toHaveBeenCalled();
});

it("keeps applied pages but leaves the check time unset when a later page fails, so the next launch resumes", async () => {
  deps.fetchChanges.mockResolvedValueOnce(page(600, true)).mockRejectedValueOnce(new Error("offline"));
  await expect(refreshVenueTable(deps)).rejects.toThrow("offline");
  expect(deps.applyChanges).toHaveBeenCalledWith(page(600, true));
  expect(deps.setCheckedAt).not.toHaveBeenCalled();
});
