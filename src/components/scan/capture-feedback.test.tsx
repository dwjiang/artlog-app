import { render, screen } from "@testing-library/react-native";

import type { CaptureController, CaptureFeedback as Feedback } from "@/lib/capture/capture-controller";
import type { Quad } from "@/lib/capture/stages";

import { CaptureFeedback, CaptureShutter } from "./capture-feedback";

let mockFeedback: Feedback = null;
const mockRing: number[] = [];
jest.mock("@shopify/react-native-skia", () => {
  const { View } = jest.requireActual("react-native");
  return { Canvas: View, Path: View };
});
jest.mock("react-native-reanimated", () => {
  const { View } = jest.requireActual("react-native");
  const { useRef } = jest.requireActual("react");
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (value: number) => useRef({ get: () => value, set: (next: number) => mockRing.push(next) }).current,
    withTiming: (value: number) => value,
    cancelAnimation: jest.fn(),
    Easing: { linear: jest.fn() },
  };
});
const controller = {
  getFeedback: () => mockFeedback,
  subscribeFeedback: () => () => {},
} as unknown as CaptureController;
const shutter = (props: Partial<{ detecting: boolean; captured: boolean }>) => (
  <CaptureShutter
    controller={controller}
    disabled={false}
    busy={false}
    detecting={false}
    captured={false}
    onPress={jest.fn()}
    {...props}
  />
);

beforeEach(() => {
  mockFeedback = null;
  mockRing.length = 0;
});

it("keeps the ring closed once the capture fires, even though detection has stopped", async () => {
  mockFeedback = {
    quad: [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
    ],
    progress: 0.875,
    guidance: "hold-still",
  };
  const view = await render(shutter({ detecting: true }));
  expect(mockRing.at(-1)).toBe(0.875);
  mockFeedback = null;
  await view.rerender(shutter({ detecting: false, captured: true }));
  expect(mockRing.at(-1)).toBe(1);
  await view.rerender(shutter({ detecting: false, captured: false }));
  expect(mockRing.at(-1)).toBe(0);
});

const quad: Quad = [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.8, 0.8],
  [0.2, 0.8],
];
const feedback = (props: Partial<{ detecting: boolean; busy: boolean }>) => (
  <CaptureFeedback controller={controller} detecting busy={false} {...props} />
);

describe("capture caption", () => {
  it("explains automatic capture before detection and then names the framing problem", async () => {
    const view = await render(feedback({}));
    expect(screen.getByText("Point at an artwork")).toBeOnTheScreen();
    expect(screen.getByText("Hold steady to scan automatically")).toBeOnTheScreen();
    mockFeedback = { quad, progress: 0, guidance: "move-closer" };
    await view.rerender(feedback({}));
    expect(screen.getByText("Move closer")).toBeOnTheScreen();
    mockFeedback = { quad, progress: 0, guidance: "fit-whole-painting" };
    await view.rerender(feedback({}));
    expect(screen.getByText("Fit the whole artwork in view")).toBeOnTheScreen();
    mockFeedback = { quad, progress: 0, guidance: "straighten" };
    await view.rerender(feedback({}));
    expect(screen.getByText("Face the artwork straight on")).toBeOnTheScreen();
    mockFeedback = { quad, progress: 0.25, guidance: "hold-still" };
    await view.rerender(feedback({}));
    expect(screen.getByText("Hold steady")).toBeOnTheScreen();
    await view.rerender(feedback({ detecting: false }));
    expect(screen.queryByText("Hold steady")).toBeNull();
  });

  it("shows only the identifying caption while a capture is busy", async () => {
    mockFeedback = { quad, progress: 0, guidance: "move-closer" };
    await render(feedback({ busy: true }));
    expect(screen.getByText("Identifying artwork")).toBeOnTheScreen();
    expect(screen.queryByText("Move closer")).toBeNull();
  });
});
