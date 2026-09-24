import { act, renderHook } from "@testing-library/react-native";
import { AccessibilityInfo, DeviceEventEmitter } from "react-native";
import { useReducedMotion } from "./use-reduced-motion";

beforeEach(() => {
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation((event, listener) =>
      DeviceEventEmitter.addListener(event, listener),
    );
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
