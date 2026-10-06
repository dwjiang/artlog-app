import { act, renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import { useCurrentMinute } from "./use-current-minute";

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("advances the clock without a database write and catches up after backgrounding", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-09-09T12:00:15Z"));
  let onChange!: (state: AppStateStatus) => void;
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    onChange = listener;
    return { remove };
  });
  const { result, unmount } = await renderHook(useCurrentMinute);
  expect(result.current).toBe(Date.parse("2026-09-09T12:00:00Z"));
  await act(() => jest.advanceTimersByTime(60_000));
  expect(result.current).toBe(Date.parse("2026-09-09T12:01:00Z"));
  await act(() => {
    jest.setSystemTime(new Date("2026-09-10T12:01:15Z"));
    onChange("active");
  });
  expect(result.current).toBe(Date.parse("2026-09-10T12:01:00Z"));
  await unmount();
  expect(remove).toHaveBeenCalled();
});
