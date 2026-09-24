import { act, renderHook } from "@testing-library/react-native";

import { dismissToast, showToast, useToast } from "./toast";

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
