import { render } from "@testing-library/react-native";

import { CaptureShutter } from "./capture-feedback";
import type {
  CaptureController,
  CaptureFeedback,
} from "@/lib/capture/capture-controller";

let mockFeedback: CaptureFeedback = null;
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
    useSharedValue: (value: number) =>
      useRef({ get: () => value, set: (next: number) => mockRing.push(next) })
        .current,
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
  };
  const view = await render(shutter({ detecting: true }));
  expect(mockRing.at(-1)).toBe(0.875);
  mockFeedback = null;
  await view.rerender(shutter({ detecting: false, captured: true }));
  expect(mockRing.at(-1)).toBe(1);
  await view.rerender(shutter({ detecting: false, captured: false }));
  expect(mockRing.at(-1)).toBe(0);
});
