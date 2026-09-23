import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ImageRef } from "expo-image";
import type { CapturePresentation } from "@/lib/capture/use-capture";
import {
  CaptureReveal,
  CROSSFADE_MS,
  HIGHLIGHT_MS,
  REVEAL_TIMEOUT_MS,
  SHINE_MS,
  STRAIGHTEN_MS,
} from "./capture-reveal";

let mockReduced = false;
const mockAnimations: { duration: number; finish?: (done: boolean) => void }[] = [];
jest.mock("react-native-worklets", () => ({ scheduleOnRN: (fn: () => void) => fn() }));
jest.mock("react-native-reanimated", () => {
  const { View } = jest.requireActual("react-native");
  const { useRef } = jest.requireActual("react");
  return {
    __esModule: true,
    default: { View },
    useReducedMotion: () => mockReduced,
    useSharedValue: (initial: number) => useRef({ get: () => initial, set: jest.fn() }).current,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withTiming: (value: number, config: { duration: number }, finish?: (done: boolean) => void) => {
      mockAnimations.push({ duration: config.duration, finish });
      return value;
    },
    withDelay: (_ms: number, value: number) => value,
    cancelAnimation: jest.fn(),
    ReduceMotion: { Never: "never" },
    Easing: { bezier: jest.fn() },
  };
});
jest.mock("expo-image", () => {
  const { View } = jest.requireActual("react-native");
  return { Image: (props: object) => <View accessible {...props} /> };
});
const presentation: CapturePresentation = {
  attempt: { id: 1, source: "camera", quad: null, valid: true },
  photoUri: "file:///photo.jpg",
  source: "camera",
  photo: {} as ImageRef,
  crop: {} as ImageRef,
  painting: {
    cropUri: "file:///crop.jpg",
    cropSize: 512,
    contentBounds: { x: 0, y: 64, width: 512, height: 384 },
    photoSize: { width: 1200, height: 1600 },
    corners: [
      [0.1, 0.2],
      [0.9, 0.2],
      [0.9, 0.8],
      [0.1, 0.8],
    ],
  },
};

beforeEach(() => {
  mockReduced = false;
  mockAnimations.length = 0;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it.each([false, true])(
  "finishes once after the reveal, with a crossfade for reduced motion: %s",
  async (reduced) => {
    mockReduced = reduced;
    const complete = jest.fn();
    const view = await render(<CaptureReveal presentation={presentation} onComplete={complete} />);
    await fireEvent(screen.getByLabelText("Captured painting"), "layout", {
      nativeEvent: { layout: { width: 390, height: 844 } },
    });
    await fireEvent(screen.getByLabelText("Isolated painting"), "display");
    expect(mockAnimations.map((a) => a.duration)).toEqual(
      reduced ? [0, CROSSFADE_MS] : [HIGHLIGHT_MS, STRAIGHTEN_MS, SHINE_MS],
    );
    expect(complete).not.toHaveBeenCalled();
    if (!reduced) {
      await act(() =>
        mockAnimations.find((animation) => animation.duration === STRAIGHTEN_MS)!.finish!(true),
      );
      expect(complete).not.toHaveBeenCalled();
    }
    await act(() => mockAnimations.at(-1)!.finish!(true));
    await view.rerender(<CaptureReveal presentation={presentation} onComplete={complete} />);
    await act(() => jest.advanceTimersByTime(REVEAL_TIMEOUT_MS));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(mockAnimations).toHaveLength(reduced ? 2 : 3);
  },
);

it("falls through once when image display fails or never arrives", async () => {
  const complete = jest.fn();
  await render(<CaptureReveal presentation={presentation} onComplete={complete} />);
  await fireEvent(screen.getByLabelText("Captured painting"), "error");
  await act(() => jest.advanceTimersByTime(REVEAL_TIMEOUT_MS));
  expect(complete).toHaveBeenCalledTimes(1);
});

it("does not strand a scan when the crop never displays", async () => {
  const complete = jest.fn();
  await render(<CaptureReveal presentation={presentation} onComplete={complete} />);
  await act(() => jest.advanceTimersByTime(REVEAL_TIMEOUT_MS));
  expect(complete).toHaveBeenCalledTimes(1);
});

it("does not complete a cancelled shine", async () => {
  const complete = jest.fn();
  await render(<CaptureReveal presentation={presentation} onComplete={complete} />);
  await fireEvent(screen.getByLabelText("Captured painting"), "layout", {
    nativeEvent: { layout: { width: 390, height: 844 } },
  });
  await fireEvent(screen.getByLabelText("Isolated painting"), "display");
  await act(() => mockAnimations.at(-1)!.finish!(false));
  expect(complete).not.toHaveBeenCalled();
});
