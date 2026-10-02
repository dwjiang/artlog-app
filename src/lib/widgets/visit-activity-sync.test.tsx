import { act, render } from "@testing-library/react-native";

import type { CurrentVisit } from "@/lib/venue/venue-reducer";

import type { VisitActivityProps } from "./visit-activity";
import { VisitActivitySync } from "./visit-activity-sync";

let mockHydrated = false;
let mockVisit: CurrentVisit | undefined;
let mockLoading = false;
let mockCount = 1;
let mockInstances: { update: jest.Mock; end: jest.Mock }[] = [];
const mockStart = jest.fn();
const mockReportError = jest.fn();
jest.mock("@/lib/account/owner-store", () => ({ useLocalOwner: () => "device:test" }));
jest.mock("@/lib/venue/use-venue", () => ({ useVenue: () => ({ visit: mockVisit, hydrated: mockHydrated }) }));
jest.mock("@/lib/journal/use-visit-works", () => ({
  useVisitWorks: () => ({ works: Array(mockCount), loading: mockLoading }),
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
  mockHydrated = false;
  mockVisit = undefined;
  mockLoading = false;
  mockCount = 1;
  mockInstances = [];
});

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
  expect(activity.update).toHaveBeenCalledWith({ venueName: "Met", count: 1, since: "1:00 PM" });
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
  expect(mockReportError).toHaveBeenCalledWith(failure, "visit.live-activity", { level: "warning" });
  mockCount = 2;
  await view.rerender(<VisitActivitySync />);
  expect(activity.update).toHaveBeenLastCalledWith(expect.objectContaining({ count: 2 }));
});
