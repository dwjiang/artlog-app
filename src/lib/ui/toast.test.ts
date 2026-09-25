import { act, renderHook } from "@testing-library/react-native";

import { dismissToast, showErrorToast, showToast, useLiftToasts, useToast, useToastLift } from "./toast";

beforeEach(() => {
  jest.useFakeTimers();
  dismissToast();
});
afterEach(() => {
  jest.useRealTimers();
});

it("shows one toast at a time and auto-dismisses it while a layer is listening", async () => {
  const { result } = await renderHook(useToast);
  expect(result.current).toBeUndefined();
  await act(() => showToast("Saved."));
  expect(result.current).toMatchObject({ message: "Saved." });
  await act(() => jest.advanceTimersByTime(4199));
  expect(result.current).toMatchObject({ message: "Saved." });
  await act(() => jest.advanceTimersByTime(1));
  expect(result.current).toBeUndefined();
});

it("replaces the current toast and restarts the timer from the newest message", async () => {
  const { result } = await renderHook(useToast);
  await act(() => showToast("First"));
  await act(() => jest.advanceTimersByTime(4000));
  await act(() => showToast("Second", { label: "Undo", onPress: jest.fn() }));
  await act(() => jest.advanceTimersByTime(4000));
  expect(result.current).toMatchObject({
    message: "Second",
    action: { label: "Undo" },
  });
  await act(() => jest.advanceTimersByTime(200));
  expect(result.current).toBeUndefined();
});

it("ignores dismissals for a toast that has already been replaced", async () => {
  const { result } = await renderHook(useToast);
  await act(() => showToast("First"));
  const first = result.current!.id;
  await act(() => showToast("Second"));
  await act(() => dismissToast(first));
  expect(result.current).toMatchObject({ message: "Second" });
  await act(() => dismissToast(result.current!.id));
  expect(result.current).toBeUndefined();
});

it("leaves no timer behind when nothing is listening, and shows the toast once a layer mounts", async () => {
  showToast("Unseen");
  expect(jest.getTimerCount()).toBe(0);
  const { result } = await renderHook(useToast);
  expect(result.current).toMatchObject({ message: "Unseen" });
});

it("lifts toasts above a focused screen's bottom bar until the screen leaves", async () => {
  const lift = await renderHook(useToastLift);
  const bar = await renderHook(({ active }: { active: boolean }) => useLiftToasts(96, active), {
    initialProps: { active: true },
  });
  expect(lift.result.current).toBe(96);
  await bar.rerender({ active: false });
  expect(lift.result.current).toBe(0);
  await bar.rerender({ active: true });
  expect(lift.result.current).toBe(96);
  await bar.unmount();
  expect(lift.result.current).toBe(0);
});

it("keeps the newly focused screen's lift when the previous screen blurs afterwards", async () => {
  const lift = await renderHook(useToastLift);
  const previous = await renderHook(({ active }: { active: boolean }) => useLiftToasts(96, active), {
    initialProps: { active: true },
  });
  await renderHook(() => useLiftToasts(120, true));
  await previous.rerender({ active: false });
  expect(lift.result.current).toBe(120);
});

it("offers Retry on a failure toast only when the operation can run again", async () => {
  const { result } = await renderHook(useToast);
  const retry = jest.fn();
  await act(() => showErrorToast("Couldn’t share this artwork.", retry));
  expect(result.current).toMatchObject({ message: "Couldn’t share this artwork.", action: { label: "Retry" } });
  result.current!.action!.onPress();
  expect(retry).toHaveBeenCalledTimes(1);
  await act(() => showErrorToast("Couldn’t finish. Try again."));
  expect(result.current?.action).toBeUndefined();
});
