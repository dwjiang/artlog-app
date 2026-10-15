import { act, renderHook } from "@testing-library/react-native";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";

import { useWallBehindBar } from "./wall-behind-bar";

jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 116 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34 }) }));

const layout = (y: number, height: number) =>
  ({ nativeEvent: { layout: { x: 0, y, width: 402, height } } }) as LayoutChangeEvent;
const scrolled = (y: number) =>
  ({ nativeEvent: { contentOffset: { x: 0, y } } }) as NativeSyntheticEvent<NativeScrollEvent>;

it("reaches the title, then the status bar as the wall scrolls up, and leaves in reverse", async () => {
  const { result } = await renderHook(() => useWallBehindBar());
  await act(() => result.current.onWallLayout(layout(600, 900)));
  const state = () => [result.current.title, result.current.status];

  await act(() => result.current.onScroll(scrolled(510)));
  expect(state()).toEqual([false, false]);
  // The wall's top edge meets the middle of the bar below the 62-point status bar, 89 points from the top…
  await act(() => result.current.onScroll(scrolled(511)));
  expect(state()).toEqual([true, false]);
  // …and the middle of the status bar at 31 points.
  await act(() => result.current.onScroll(scrolled(569)));
  expect(state()).toEqual([true, true]);
  await act(() => result.current.onScroll(scrolled(0)));
  expect(state()).toEqual([false, false]);
});

it("stays clear of the bar until the wall has been laid out", async () => {
  const { result } = await renderHook(() => useWallBehindBar());
  await act(() => result.current.onScroll(scrolled(5000)));
  expect([result.current.title, result.current.status]).toEqual([false, false]);
});
