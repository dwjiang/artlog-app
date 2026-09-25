import { act, render, screen } from "@testing-library/react-native";

import { toCorners } from "@/lib/capture/rectangle";
import type { Quad } from "@/lib/capture/stages";

import { DetectionLog, DevTimings, formatCaptureTimings } from "./dev-timings";

jest.mock("@/hooks/use-screen-active", () => ({ useScreenActive: () => true }));
jest.mock("@/db/client", () => ({
  db: jest.requireActual("@/db/test-db").createTestDatabase(),
}));

it("lists the total and each recorded stage in milliseconds", async () => {
  const timings = {
    warp: 273.4,
    triage: 8.6,
    embed: 480.2,
    orb: 11.7,
    identify: 38.1,
    total: 812.0,
  };
  expect(formatCaptureTimings(timings)).toBe("Capture 812 ms · warp 273 · triage 9 · embed 480 · orb 12 · identify 38");
  expect(formatCaptureTimings({ warp: 300, enqueue: 4.4, total: 304.4 })).toBe("Capture 304 ms · warp 300 · enqueue 4");
  await render(<DevTimings timings={timings} />);
  expect(screen.getByText(/^Capture 812 ms/)).toBeOnTheScreen();
});

it("renders nothing before the first capture", async () => {
  const empty = await render(<DevTimings />);
  expect(empty.toJSON()).toBeNull();
});

it("shows the detector's hit rate over the last second and what the controller made of it", async () => {
  const now = jest.spyOn(performance, "now");
  const log = new DetectionLog();
  const frame = { width: 1080, height: 1440 };
  const quad: Quad = [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ];
  const painting = { confidence: 1, corners: toCorners(quad) };
  const view = await render(<DevTimings detection={log} />);
  expect(view.toJSON()).toBeNull();
  now.mockReturnValue(0);
  await act(() => log.record({ ...frame, observations: [painting] }, { quad, progress: 0.5, guidance: "hold-still" }));
  expect(screen.getByText("Detect 1/1 frames · best 1.00 · hold-still 50%")).toBeOnTheScreen();
  now.mockReturnValue(500);
  await act(() => log.record({ ...frame, observations: [] }, null));
  expect(screen.getByText("Detect 1/2 frames · best 1.00 · no candidate")).toBeOnTheScreen();
  now.mockReturnValue(1200);
  await act(() => log.record({ ...frame, observations: [] }, null));
  expect(screen.getByText("Detect 0/2 frames · best 0.00 · no candidate")).toBeOnTheScreen();
});
