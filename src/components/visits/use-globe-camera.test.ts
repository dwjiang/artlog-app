import { act, render, renderHook } from "@testing-library/react-native";
import { createElement } from "react";
import {
  ReduceMotion,
  ReducedMotionConfig,
  setUpTests,
} from "react-native-reanimated";
import { useGlobeCamera } from "./use-globe-camera";
import type { GlobeCamera } from "@/lib/journal/globe-geometry";

jest.unmock("react-native-reanimated");
jest.mock("react-native-worklets", () => ({
  ...jest.requireActual("react-native-worklets/src/mock"),
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
    fn(...args),
  scheduleOnUI: (fn: (...args: unknown[]) => void, ...args: unknown[]) =>
    fn(...args),
}));

setUpTests();
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

type Controls = ReturnType<typeof useGlobeCamera>;
type PanEvent = Parameters<
  NonNullable<Controls["pan"]["handlers"]["onBegin"]>
>[0];

function panEvent(overrides: Partial<PanEvent> = {}): PanEvent {
  return {
    translationX: 50,
    translationY: 20,
    velocityX: 600,
    velocityY: 200,
    ...overrides,
  } as PanEvent;
}
function flick(controls: Controls, event = panEvent()) {
  controls.pan.handlers.onBegin?.(event);
  controls.pan.handlers.onStart?.(event);
  controls.pan.handlers.onUpdate?.(event);
  controls.pan.handlers.onEnd?.(event, true);
  controls.pan.handlers.onFinalize?.(event, true);
}
async function renderCamera(initialCamera: GlobeCamera, onChange = jest.fn()) {
  return renderHook<Controls, { camera: GlobeCamera }>(
    ({ camera }) => useGlobeCamera(camera, onChange),
    { initialProps: { camera: initialCamera } },
  );
}

it("continues rotating after release, slows down, and saves the settled camera", async () => {
  const onChange = jest.fn();
  const { result } = await renderCamera(
    { yaw: 0, pitch: 0, zoom: 1 },
    onChange,
  );
  await act(() => flick(result.current));
  const released = result.current.camera.get();
  await act(() => jest.advanceTimersByTime(100));
  const coasting = result.current.camera.get();
  expect(coasting.yaw).toBeGreaterThan(released.yaw);
  expect(coasting.pitch).toBeGreaterThan(released.pitch);
  expect(onChange).not.toHaveBeenCalled();
  await act(() => jest.advanceTimersByTime(100));
  expect(result.current.camera.get().yaw - coasting.yaw).toBeLessThan(
    coasting.yaw - released.yaw,
  );
  await act(() => jest.advanceTimersByTime(3000));
  const settled = result.current.camera.get();
  expect(onChange).toHaveBeenLastCalledWith(settled);
  await act(() => jest.advanceTimersByTime(1000));
  expect(result.current.camera.get()).toEqual(settled);
});

it("stops on touch down and starts the next drag from the interrupted position", async () => {
  const { result } = await renderCamera({ yaw: 0, pitch: 0, zoom: 1 });
  await act(() => flick(result.current));
  await act(() => jest.advanceTimersByTime(100));
  await act(() => result.current.pan.handlers.onBegin?.(panEvent()));
  const stopped = result.current.camera.get();
  await act(() => jest.advanceTimersByTime(1000));
  expect(result.current.camera.get()).toEqual(stopped);
  await act(() => {
    result.current.pan.handlers.onStart?.(panEvent());
    result.current.pan.handlers.onUpdate?.(
      panEvent({ translationX: -10, translationY: 0 }),
    );
  });
  expect(result.current.camera.get().yaw).toBeCloseTo(stopped.yaw - 3.4);
  expect(result.current.camera.get().pitch).toBe(stopped.pitch);
});

it("crosses the date line continuously and keeps a vertical flick within the poles", async () => {
  const { result } = await renderCamera({ yaw: 359, pitch: 70, zoom: 1 });
  await act(() => flick(result.current));
  const released = result.current.camera.get();
  expect(released.yaw).toBeGreaterThan(360);
  await act(() => jest.advanceTimersByTime(3000));
  expect(result.current.camera.get().yaw).toBeGreaterThan(released.yaw);
  expect(result.current.camera.get().pitch).toBe(75);
});

it("scales drag and release speed with the zoom level", async () => {
  const normal = await renderCamera({ yaw: 0, pitch: 0, zoom: 1 });
  const zoomed = await renderCamera({ yaw: 0, pitch: 0, zoom: 2 });
  await act(() => {
    flick(normal.result.current);
    flick(zoomed.result.current);
  });
  await act(() => jest.advanceTimersByTime(100));
  expect(zoomed.result.current.camera.get().yaw).toBeCloseTo(
    normal.result.current.camera.get().yaw / 2,
  );
});

it("lets a pinch take over without resuming rotation or saving an unfinished camera", async () => {
  const onChange = jest.fn();
  const { result } = await renderCamera(
    { yaw: 0, pitch: 0, zoom: 1 },
    onChange,
  );
  await act(() => flick(result.current));
  await act(() => jest.advanceTimersByTime(100));
  type PinchEvent = Parameters<
    NonNullable<Controls["pinch"]["handlers"]["onStart"]>
  >[0];
  const pinch = { scale: 1.5 } as PinchEvent;
  await act(() => {
    // A recognizer that loses to the pan must not persist a mid-flight camera.
    result.current.pinch.handlers.onFinalize?.(pinch, false);
  });
  expect(onChange).not.toHaveBeenCalled();
  await act(() => {
    result.current.pinch.handlers.onStart?.(pinch);
    result.current.pan.handlers.onFinalize?.(panEvent(), false);
    result.current.pinch.handlers.onUpdate?.(pinch);
  });
  expect(onChange).not.toHaveBeenCalled();
  const pinched = result.current.camera.get();
  expect(pinched.zoom).toBe(1.5);
  await act(() => result.current.pinch.handlers.onFinalize?.(pinch, true));
  await act(() => jest.advanceTimersByTime(1000));
  expect(result.current.camera.get()).toEqual(pinched);
  expect(onChange).toHaveBeenLastCalledWith(pinched);
});

it("cancels momentum when the camera is reset or focused on a museum", async () => {
  const { result } = await renderCamera({ yaw: 0, pitch: 0, zoom: 1 });
  await act(() => flick(result.current));
  await act(() => jest.advanceTimersByTime(100));
  const destination = { yaw: -2, pitch: 49, zoom: 1 };
  await act(() => result.current.setCamera(destination));
  await act(() => jest.advanceTimersByTime(1000));
  expect(result.current.camera.get()).toEqual(destination);
});

it("settles on demand: stops momentum and saves the position reached", async () => {
  const onChange = jest.fn();
  const { result } = await renderCamera(
    { yaw: 0, pitch: 0, zoom: 1 },
    onChange,
  );
  await act(() => flick(result.current));
  await act(() => jest.advanceTimersByTime(100));
  await act(() => result.current.settle());
  const settled = result.current.camera.get();
  expect(settled.yaw).toBeGreaterThan(17);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(settled);
  await act(() => jest.advanceTimersByTime(3000));
  expect(result.current.camera.get()).toEqual(settled);
  expect(onChange).toHaveBeenCalledTimes(1);
});

it("saves the current position when switching away during momentum", async () => {
  const onChange = jest.fn();
  const { result, unmount } = await renderCamera(
    { yaw: 0, pitch: 0, zoom: 1 },
    onChange,
  );
  await act(() => flick(result.current));
  await act(() => jest.advanceTimersByTime(100));
  const interrupted = result.current.camera.get();
  await unmount();
  expect(onChange).toHaveBeenLastCalledWith(interrupted);
});

it("keeps direct dragging but skips momentum when Reduce Motion is enabled", async () => {
  await render(
    createElement(ReducedMotionConfig, { mode: ReduceMotion.Always }),
  );
  const { result } = await renderCamera({ yaw: 0, pitch: 0, zoom: 1 });
  await act(() => flick(result.current));
  const released = result.current.camera.get();
  expect(released.yaw).toBeGreaterThan(0);
  await act(() => jest.advanceTimersByTime(1000));
  expect(result.current.camera.get()).toEqual(released);
});
