import { act, renderHook } from "@testing-library/react-native";
import type { Frame } from "react-native-vision-camera";

import type { RectDetection } from "../../../modules/vision-rect/src";
import { CaptureController } from "./capture-controller";
import { STABLE_WINDOW_MS, toCorners } from "./rectangle";
import type { Quad } from "./stages";
import { useRectDetector } from "./use-rect-detector";

let mockOnFrame: (frame: Frame) => void;
const mockDetect = jest.fn();
let mockReports: (() => void)[] = [];
jest.mock("../../../modules/vision-rect/src", () => ({ getVisionRect: () => ({ detect: mockDetect }) }));
jest.mock("react-native-vision-camera", () => ({
  CommonResolutions: { HD_4_3: { width: 1024, height: 768 } },
  useFrameOutput: ({ onFrame }: { onFrame: (frame: Frame) => void }) => {
    mockOnFrame = onFrame;
    return { outputOrientation: "up" };
  },
}));
jest.mock("react-native-worklets", () => ({
  scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => {
    mockReports.push(() => callback(...args));
  },
}));

const size = { width: 768, height: 1024 };
const quad: Quad = [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.8, 0.8],
  [0.2, 0.8],
];
const detection: RectDetection = { ...size, observations: [{ corners: toCorners(quad), confidence: 1 }] };

function frame(timestamp: number) {
  const dispose = jest.fn();
  mockOnFrame({ timestamp, dispose } as unknown as Frame);
  expect(dispose).toHaveBeenCalledTimes(1);
}

function deliver() {
  const reports = mockReports;
  mockReports = [];
  reports.forEach((report) => report());
}

beforeEach(() => {
  jest.useFakeTimers({ now: 10_000 });
  mockReports = [];
  mockDetect.mockReturnValue(detection);
});
afterEach(() => jest.useRealTimers());

it("keeps camera timestamps in milliseconds despite small delivery delays", async () => {
  const onDetection = jest.fn();
  await renderHook(() => useRectDetector(true, "up", onDetection, jest.fn()));
  frame(123.456);
  jest.setSystemTime(10_050);
  await act(deliver);
  expect(onDetection).toHaveBeenCalledWith(detection, 123_456);
});

it("accepts a fresh report even when native detection itself takes longer", async () => {
  const onDetection = jest.fn();
  await renderHook(() => useRectDetector(true, "up", onDetection, jest.fn()));
  mockDetect.mockImplementationOnce(() => {
    jest.setSystemTime(10_300);
    return detection;
  });
  frame(0);
  await act(deliver);
  expect(onDetection).toHaveBeenCalledWith(detection, 0);
});

it("drops a buffered hold and requires fresh stable frames before capture", async () => {
  const controller = new CaptureController();
  const attempts: unknown[] = [];
  const onDetection = (result: RectDetection, at: number) => {
    const attempt = controller.observe(result, size, at);
    if (attempt) attempts.push(attempt);
  };
  await renderHook(() => useRectDetector(true, "up", onDetection, controller.resetDetection));
  frame(0);
  await act(deliver);
  for (let at = 100; at <= STABLE_WINDOW_MS; at += 100) {
    jest.setSystemTime(10_000 + at);
    frame(at / 1000);
  }
  jest.setSystemTime(11_000);
  await act(deliver);
  expect(attempts).toHaveLength(0);
  expect(controller.getFeedback()).toBeNull();
  for (let at = 1000; at < 1000 + STABLE_WINDOW_MS; at += 100) {
    jest.setSystemTime(10_000 + at);
    frame(at / 1000);
    await act(deliver);
    expect(attempts).toHaveLength(0);
  }
  jest.setSystemTime(11_000 + STABLE_WINDOW_MS);
  frame((1000 + STABLE_WINDOW_MS) / 1000);
  await act(deliver);
  expect(attempts).toHaveLength(1);
});

it("ignores reports from before a pause even if the camera has already resumed", async () => {
  const onDetection = jest.fn();
  const onReset = jest.fn();
  const hook = await renderHook(
    ({ active }: { active: boolean }) => useRectDetector(active, "up", onDetection, onReset),
    {
      initialProps: { active: true },
    },
  );
  frame(0);
  jest.setSystemTime(10_050);
  await hook.rerender({ active: false });
  jest.setSystemTime(10_100);
  await hook.rerender({ active: true });
  await act(deliver);
  expect(onDetection).not.toHaveBeenCalled();
  frame(0.1);
  await act(deliver);
  expect(onDetection).toHaveBeenCalledTimes(1);
});
