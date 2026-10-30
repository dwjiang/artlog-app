import { act, render } from "@testing-library/react-native";

import type { CurrentVisit } from "@/lib/venue/venue-reducer";

import type { VisitActivityProps } from "./visit-activity";
import { VisitActivitySync } from "./visit-activity-sync";

let mockHydrated = false;
let mockVisit: CurrentVisit | undefined;
let mockLoading = false;
let mockCount = 1;
let mockPhotos: (string | null)[] = [];
let mockInstances: { update: jest.Mock; end: jest.Mock }[] = [];
const mockStart = jest.fn();
const mockReportError = jest.fn();
const mockPrepareThumbnails = jest.fn(async (paths: string[]) => paths.map((path) => `file:///shared/${path}.jpg`));
const mockPruneThumbnails = jest.fn();
const mockPrepareFont = jest.fn(async () => {});
jest.mock("@/lib/account/owner-store", () => ({ useLocalOwner: () => "device:test" }));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({ visit: mockVisit, hydrated: mockHydrated }) }));
jest.mock("@/lib/journal/use-visit-works", () => ({
  useVisitWorks: () => ({
    works: Array.from({ length: mockCount }, (_, index) => ({ cropPath: mockPhotos[index] ?? null })),
    loading: mockLoading,
  }),
}));
jest.mock("./widget-storage", () => ({
  prepareWidgetFont: () => mockPrepareFont(),
  prepareVisitThumbnails: (paths: string[]) => mockPrepareThumbnails(paths),
  pruneVisitThumbnails: (keep: string[]) => mockPruneThumbnails(keep),
}));
jest.mock("@/lib/observability", () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }));
jest.mock("./visit-activity", () => ({
  VisitActivity: { getInstances: () => mockInstances, start: (...args: unknown[]) => mockStart(...args) },
}));

const visit: CurrentVisit = {
  localId: "visit-1",
  venueId: "met" as never,
  venueName: "Met",
  startedAt: Date.UTC(2026, 9, 2, 17),
  visitedOn: "2026-10-02",
  timeZone: "America/New_York",
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 9, 2, 18));
  mockHydrated = false;
  mockVisit = undefined;
  mockLoading = false;
  mockCount = 1;
  mockPhotos = [];
  mockInstances = [];
});
afterEach(() => jest.restoreAllMocks());

it("waits for visit hydration and its artwork count before adopting the restored activity", async () => {
  const activity = { update: jest.fn().mockResolvedValue(undefined), end: jest.fn().mockResolvedValue(undefined) };
  mockInstances = [activity];
  const view = await render(<VisitActivitySync />);
  expect(activity.end).not.toHaveBeenCalled();
  expect(activity.update).not.toHaveBeenCalled();
  mockHydrated = true;
  mockVisit = visit;
  mockLoading = true;
  await view.rerender(<VisitActivitySync />);
  expect(activity.end).not.toHaveBeenCalled();
  expect(activity.update).not.toHaveBeenCalled();
  mockLoading = false;
  await view.rerender(<VisitActivitySync />);
  expect(activity.update).toHaveBeenCalledWith({ venueName: "Met", count: 1, since: "1:00 PM", thumbnails: [] });
  expect(mockStart).not.toHaveBeenCalled();
});

it("waits for an orphan's native end before starting a newly restored visit", async () => {
  const ended = deferred();
  const activity = {
    update: jest.fn(),
    end: jest.fn(async () => {
      await ended.promise;
      mockInstances = [];
    }),
  };
  mockHydrated = true;
  mockInstances = [activity];
  const view = await render(<VisitActivitySync />);
  expect(activity.end).toHaveBeenCalledWith("immediate");
  mockVisit = visit;
  await view.rerender(<VisitActivitySync />);
  expect(mockStart).not.toHaveBeenCalled();
  expect(activity.update).not.toHaveBeenCalled();
  await act(async () => {
    ended.resolve();
  });
  expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ venueName: "Met", count: 1 }), "artlog:///scan");
});

it("finishes an older native update before applying the newest artwork count", async () => {
  const firstUpdate = deferred();
  let displayedCount = 0;
  const activity = {
    update: jest.fn(async (props: VisitActivityProps) => {
      if (props.count === 1) await firstUpdate.promise;
      displayedCount = props.count;
    }),
    end: jest.fn(),
  };
  mockInstances = [activity];
  mockHydrated = true;
  mockVisit = visit;
  const view = await render(<VisitActivitySync />);
  mockCount = 2;
  await view.rerender(<VisitActivitySync />);
  expect(activity.update).toHaveBeenCalledTimes(1);
  await act(async () => {
    firstUpdate.resolve();
  });
  expect(displayedCount).toBe(2);
  expect(activity.update).toHaveBeenCalledTimes(2);
});

it("reports native failures and continues syncing later snapshots", async () => {
  const failure = new Error("Activity update failed");
  const activity = { update: jest.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined), end: jest.fn() };
  mockInstances = [activity];
  mockHydrated = true;
  mockVisit = visit;
  const view = await render(<VisitActivitySync />);
  expect(mockReportError).toHaveBeenCalledWith(failure, "visit.live-activity", {
    level: "warning",
    data: { step: "update", app_state: expect.anything() },
  });
  mockCount = 2;
  await view.rerender(<VisitActivitySync />);
  expect(activity.update).toHaveBeenLastCalledWith(expect.objectContaining({ count: 2 }));
});

it("shows the newest three visit photos and removes thumbnails the activity no longer shows", async () => {
  const activity = { update: jest.fn().mockResolvedValue(undefined), end: jest.fn() };
  mockInstances = [activity];
  mockHydrated = true;
  mockVisit = visit;
  mockCount = 5;
  mockPhotos = ["newest", null, "second", "third", "fourth"];
  await render(<VisitActivitySync />);
  const thumbnails = ["file:///shared/newest.jpg", "file:///shared/second.jpg", "file:///shared/third.jpg"];
  expect(activity.update).toHaveBeenCalledWith(expect.objectContaining({ count: 5, thumbnails }));
  expect(mockPruneThumbnails).toHaveBeenLastCalledWith(thumbnails);
  expect(activity.update.mock.invocationCallOrder[0]).toBeLessThan(mockPruneThumbnails.mock.invocationCallOrder[0]);
});

it("removes every visit thumbnail once the visit's activity has ended", async () => {
  const activity = { update: jest.fn(), end: jest.fn().mockResolvedValue(undefined) };
  mockInstances = [activity];
  mockHydrated = true;
  await render(<VisitActivitySync />);
  expect(activity.end).toHaveBeenCalledWith("immediate");
  expect(mockPruneThumbnails).toHaveBeenCalledWith([]);
  expect(activity.end.mock.invocationCallOrder[0]).toBeLessThan(mockPruneThumbnails.mock.invocationCallOrder[0]);
});

it("starts the activity in the system font when the widget font cannot be prepared", async () => {
  const failure = new Error("Widget font is unavailable");
  mockPrepareFont.mockRejectedValueOnce(failure);
  mockHydrated = true;
  mockVisit = visit;
  await render(<VisitActivitySync />);
  expect(mockReportError).toHaveBeenCalledWith(failure, "visit.live-activity.font", { level: "warning" });
  expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ venueName: "Met" }), "artlog:///scan");
});
