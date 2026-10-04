import { act, render, screen } from "@testing-library/react-native";

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
    createAnimatedComponent: (component: unknown) => component,
    cubicBezier: () => "ease-out",
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

const settle = (ms: number) => act(() => jest.advanceTimersByTime(ms));
const show = async (view: Awaited<ReturnType<typeof render>>, next: Feedback, props = {}) => {
  mockFeedback = next;
  await view.rerender(feedback(props));
};

describe("capture caption", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("names a framing problem only once it has persisted", async () => {
    const view = await render(feedback({}));
    await show(view, { quad, progress: 0, guidance: "move-closer" });
    await settle(599);
    expect(screen.queryByText("Move closer")).toBeNull();
    await settle(1);
    expect(screen.getByText("Move closer")).toBeOnTheScreen();
    await show(view, { quad, progress: 0, guidance: "fit-whole-painting" });
    await settle(600);
    expect(screen.getByText("Fit the whole artwork in view")).toBeOnTheScreen();
    await show(view, { quad, progress: 0, guidance: "straighten" });
    await settle(600);
    expect(screen.getByText("Face the artwork straight on")).toBeOnTheScreen();
  });

  it("keeps the current hint through brief framing changes", async () => {
    const view = await render(feedback({}));
    await show(view, { quad, progress: 0, guidance: "move-closer" });
    await settle(600);
    for (const guidance of ["hold-still", "straighten", "move-closer", "ready", "move-closer"] as const) {
      await show(view, { quad, progress: 0, guidance });
      await settle(300);
      expect(screen.getByText("Move closer")).toBeOnTheScreen();
    }
    await show(view, null);
    await settle(600);
    expect(screen.queryByText("Move closer")).toBeNull();
  });

  it("suppresses a transient problem already present when detection starts", async () => {
    mockFeedback = { quad, progress: 0, guidance: "move-closer" };
    const view = await render(feedback({}));
    expect(screen.queryByText("Move closer")).toBeNull();
    await settle(300);
    await show(view, null);
    await settle(600);
    expect(screen.queryByText("Move closer")).toBeNull();
  });

  it("never captions searching or a steady hold", async () => {
    const view = await render(feedback({}));
    for (const guidance of ["searching", "hold-still", "ready"] as const) {
      await show(view, { quad, progress: 0.25, guidance });
      await settle(600);
      expect(screen.queryByText(/./)).toBeNull();
    }
  });

  it("clears the hint as soon as detection stops", async () => {
    const view = await render(feedback({}));
    await show(view, { quad, progress: 0, guidance: "straighten" });
    await settle(600);
    await view.rerender(feedback({ detecting: false }));
    expect(screen.queryByText("Face the artwork straight on")).toBeNull();
  });

  it("shows only the identifying caption while a capture is busy", async () => {
    mockFeedback = { quad, progress: 0, guidance: "move-closer" };
    await render(feedback({ busy: true }));
    expect(screen.getByText("Identifying artwork")).toBeOnTheScreen();
    await settle(600);
    expect(screen.queryByText("Move closer")).toBeNull();
  });
});
