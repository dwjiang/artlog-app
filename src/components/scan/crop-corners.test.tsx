import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { State, type LegacyPanGesture } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";

import { wholePhoto } from "@/lib/capture/crop-geometry";

import { CropCorners } from "./crop-corners";

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: {
    View: jest.requireActual("react-native").View,
    createAnimatedComponent: (component: unknown) => component,
  },
  useAnimatedStyle: (style: () => unknown) => style(),
  useEvent: () => jest.fn(),
  useSharedValue: (initial: unknown) => {
    const { useRef } = jest.requireActual("react");
    const value = useRef(initial);
    return useRef({
      get: () => value.current,
      set: (next: unknown) => {
        value.current = next;
      },
    }).current;
  },
}));
jest.mock("react-native-worklets", () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));

async function editor(
  onChange = jest.fn(),
  disabled = false,
  drag?: { onDragStart: () => void; onDragEnd: () => void },
) {
  await render(
    <CropCorners
      uri="file:///painting.jpg"
      size={{ width: 200, height: 200 }}
      corners={wholePhoto}
      onChange={onChange}
      disabled={disabled}
      {...drag}
    />,
  );
  await fireEvent(screen.getByLabelText("Full photo for crop adjustment"), "layout", {
    nativeEvent: { layout: { width: 200, height: 200 } },
  });
  return onChange;
}

it("opens the crop canvas with native development gesture checks enabled", async () => {
  // Gesture Handler skips its required-root check in Jest unless the environment matches a development build.
  const environment = jest.replaceProperty(process.env, "NODE_ENV", "development");
  try {
    await editor();
    expect(screen.getAllByRole("adjustable")).toHaveLength(4);
  } finally {
    environment.restore();
  }
});

it("commits one crop after a drag with multiple updates", async () => {
  const events: string[] = [];
  const onChange = await editor(
    jest.fn(() => events.push("commit")),
    false,
    {
      onDragStart: () => events.push("start"),
      onDragEnd: () => events.push("end"),
    },
  );
  await act(() =>
    fireGestureHandler<LegacyPanGesture>(getByGestureTestId("crop-corner-0"), [
      { state: State.BEGAN, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX: 10, translationY: 10 },
      { state: State.ACTIVE, translationX: 20, translationY: 30 },
      { state: State.END, translationX: 30, translationY: 40 },
    ]),
  );
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(events).toEqual(["start", "commit", "end"]);
  expect(onChange).toHaveBeenCalledWith([
    [0.15, 0.2],
    [1, 0],
    [1, 1],
    [0, 1],
  ]);
});

it("restores a cancelled drag before the next drag starts", async () => {
  const events: string[] = [];
  const onChange = await editor(
    jest.fn(() => events.push("commit")),
    false,
    {
      onDragStart: () => events.push("start"),
      onDragEnd: () => events.push("end"),
    },
  );
  const corner = getByGestureTestId("crop-corner-0");
  await act(() =>
    fireGestureHandler<LegacyPanGesture>(corner, [
      { state: State.BEGAN },
      { state: State.ACTIVE, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX: 50, translationY: 40 },
      { state: State.CANCELLED },
    ]),
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(events).toEqual(["start", "end"]);
  await act(() =>
    fireGestureHandler<LegacyPanGesture>(corner, [
      { state: State.BEGAN },
      { state: State.ACTIVE, translationX: 10, translationY: 20 },
      { state: State.END, translationX: 10, translationY: 20 },
    ]),
  );
  expect(onChange).toHaveBeenCalledWith([
    [0.05, 0.1],
    [1, 0],
    [1, 1],
    [0, 1],
  ]);
});

it("keeps the last valid crop when a corner crosses the opposite edge", async () => {
  const onChange = await editor();
  await act(() =>
    fireGestureHandler<LegacyPanGesture>(getByGestureTestId("crop-corner-0"), [
      { state: State.BEGAN },
      { state: State.ACTIVE, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX: 20, translationY: 20 },
      { state: State.ACTIVE, translationX: 180, translationY: 180 },
      { state: State.END, translationX: 180, translationY: 180 },
    ]),
  );
  expect(onChange).toHaveBeenCalledWith([
    [0.1, 0.1],
    [1, 0],
    [1, 1],
    [0, 1],
  ]);
});

it("keeps every corner adjustable with VoiceOver actions", async () => {
  const onChange = await editor();
  const corner = screen.getByRole("adjustable", { name: "Top left corner" });
  await fireEvent(corner, "accessibilityAction", { nativeEvent: { actionName: "right" } });
  await fireEvent(corner, "accessibilityAction", { nativeEvent: { actionName: "down" } });
  expect(onChange).toHaveBeenLastCalledWith([
    [0.01, 0.01],
    [1, 0],
    [1, 1],
    [0, 1],
  ]);
  expect(screen.getAllByRole("adjustable")).toHaveLength(4);
});

it("disables crop adjustments while the crop is saving", async () => {
  const onChange = await editor(jest.fn(), true);
  const corner = screen.getByRole("adjustable", { name: "Top left corner" });
  expect(corner).toBeDisabled();
  await fireEvent(corner, "accessibilityAction", { nativeEvent: { actionName: "right" } });
  expect(onChange).not.toHaveBeenCalled();
});
