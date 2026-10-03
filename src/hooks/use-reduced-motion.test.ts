import { act, renderHook } from "@testing-library/react-native";
import { AccessibilityInfo, DeviceEventEmitter } from "react-native";

import { useReducedMotion } from "./use-reduced-motion";

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation((event, listener) => DeviceEventEmitter.addListener(event, listener));
});
afterEach(() => jest.restoreAllMocks());

it("keeps loading motion off until the preference is known and follows live changes", async () => {
  let resolve!: (enabled: boolean) => void;
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result } = await renderHook(useReducedMotion);
  expect(result.current).toBe(true);
  await act(() => resolve(false));
  expect(result.current).toBe(false);
  await act(() => DeviceEventEmitter.emit("reduceMotionChanged", true));
  expect(result.current).toBe(true);
});

it("does not overwrite a changed preference with a late initial read", async () => {
  let resolve!: (enabled: boolean) => void;
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result } = await renderHook(useReducedMotion);
  await act(() => DeviceEventEmitter.emit("reduceMotionChanged", true));
  await act(() => resolve(false));
  expect(result.current).toBe(true);
});

it("shares the resolved preference and one native subscription with newly mounted controls", async () => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  const first = await renderHook(useReducedMotion);
  expect(first.result.current).toBe(false);
  const second = await renderHook(useReducedMotion);
  expect(second.result.current).toBe(false);
  expect(AccessibilityInfo.addEventListener).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
  await first.unmount();
  await act(() => DeviceEventEmitter.emit("reduceMotionChanged", true));
  expect(second.result.current).toBe(true);
});

it("ignores a pending preference read after the last consumer unmounts", async () => {
  let resolveOld!: (enabled: boolean) => void;
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockReturnValueOnce(
      new Promise((done) => {
        resolveOld = done;
      }),
    )
    .mockResolvedValue(true);
  const previous = await renderHook(useReducedMotion);
  await previous.unmount();
  const current = await renderHook(useReducedMotion);
  await act(() => resolveOld(false));
  expect(current.result.current).toBe(true);
});
