import { act, renderHook } from "@testing-library/react-native";
import type { LayoutChangeEvent, RefreshControlProps } from "react-native";
import type { AnimatedRef } from "react-native-reanimated";

import { usePullToRefresh } from "./pull-to-refresh";

const scrollRef = { current: null } as unknown as AnimatedRef<never>;
const control = (result: { current: ReturnType<typeof usePullToRefresh> }) =>
  result.current.refreshControl?.props as RefreshControlProps;
const layout = (y: number, height: number) =>
  ({ nativeEvent: { layout: { x: 0, y, width: 402, height } } }) as LayoutChangeEvent;

it("draws the spinner under the lowest header view", async () => {
  const { result } = await renderHook(() => usePullToRefresh(scrollRef, { onRefresh: jest.fn() }));
  expect(control(result).progressViewOffset).toBe(0);
  await act(() => result.current.onHeaderLayout(layout(-54, 230)));
  expect(control(result).progressViewOffset).toBe(176);
});

it("keeps the spinner turning until the refresh it started settles", async () => {
  let finish!: () => void;
  const onRefresh = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = await renderHook(() => usePullToRefresh(scrollRef, { onRefresh }));
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
    ({ refreshing }: { refreshing: boolean }) => usePullToRefresh(scrollRef, { refreshing, onRefresh }),
    { initialProps: { refreshing: false } },
  );
  await act(() => control(view.result).onRefresh?.());
  expect(view.result.current.refreshing).toBe(false);
  await view.rerender({ refreshing: true });
  expect(control(view.result).refreshing).toBe(true);
});

it("offers no pull and no spinner while disabled", async () => {
  const { result } = await renderHook(() =>
    usePullToRefresh(scrollRef, { enabled: false, refreshing: true, onRefresh: jest.fn() }),
  );
  expect(result.current.refreshControl).toBeUndefined();
  expect(result.current.refreshing).toBe(false);
});
