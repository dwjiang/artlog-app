import { act, renderHook } from "@testing-library/react-native";
import type { RefreshControlProps } from "react-native";

import { usePullToRefresh } from "./pull-to-refresh";

const control = (result: { current: ReturnType<typeof usePullToRefresh> }) =>
  result.current.refreshControl?.props as RefreshControlProps;

it("keeps the spinner turning until the refresh it started settles", async () => {
  let finish!: () => void;
  const onRefresh = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = await renderHook(() => usePullToRefresh({ onRefresh }));
  await act(() => control(result).onRefresh?.());
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(result.current.refreshing).toBe(true);
  expect(control(result).refreshing).toBe(true);
  await act(async () => finish());
  expect(result.current.refreshing).toBe(false);
  expect(control(result).refreshing).toBe(false);
});

it("follows the caller's refreshing state when the refresh returns nothing", async () => {
  const onRefresh = jest.fn();
  const view = await renderHook(
    ({ refreshing }: { refreshing: boolean }) => usePullToRefresh({ refreshing, onRefresh }),
    { initialProps: { refreshing: false } },
  );
  await act(() => control(view.result).onRefresh?.());
  expect(view.result.current.refreshing).toBe(false);
  await view.rerender({ refreshing: true });
  expect(control(view.result).refreshing).toBe(true);
});

it("offers no pull and no spinner while disabled", async () => {
  const { result } = await renderHook(() =>
    usePullToRefresh({ enabled: false, refreshing: true, onRefresh: jest.fn() }),
  );
  expect(result.current.refreshControl).toBeUndefined();
  expect(result.current.refreshing).toBe(false);
});
