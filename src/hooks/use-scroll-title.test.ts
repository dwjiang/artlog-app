import { act, renderHook } from "@testing-library/react-native";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView, Text } from "react-native";

import { Gallery } from "@/constants/theme";

import { useScrollTitle } from "./use-scroll-title";

const mockSetOptions = jest.fn();
jest.mock("expo-router", () => ({ useNavigation: () => ({ setOptions: mockSetOptions }) }));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 116 }));

const heading = (y: number, height: number) =>
  ({ nativeEvent: { layout: { x: 0, y, width: 402, height } } }) as LayoutChangeEvent;
const scrolled = (y: number) =>
  ({ nativeEvent: { contentOffset: { x: 0, y } } }) as NativeSyntheticEvent<NativeScrollEvent>;
const options = () => mockSetOptions.mock.calls.map(([value]) => value);
const titleColors = () => options().flatMap((value) => (value.headerTitleStyle ? [value.headerTitleStyle.color] : []));
const titles = () => options().flatMap((value) => ("title" in value ? [value.title] : []));

beforeEach(() => mockSetOptions.mockClear());

it("names the page in the bar from the start, so a screen pushed from here can name it", async () => {
  await renderHook(() => useScrollTitle("Water Lilies"));
  expect(titles()).toEqual(["Water Lilies"]);
  expect(titleColors()).toEqual([]);
});

it("shows the title only while the heading is under the bar, updating once per change", async () => {
  const { result } = await renderHook(() => useScrollTitle("Water Lilies"));
  await act(() => result.current.onHeadingLayout(heading(200, 40)));
  for (const y of [-116, 0, 123]) await act(() => result.current.onScroll(scrolled(y)));
  expect(titleColors()).toEqual([]);
  for (const y of [124, 200, 400]) await act(() => result.current.onScroll(scrolled(y)));
  expect(titleColors()).toEqual([Gallery.ink]);
  for (const y of [100, -116]) await act(() => result.current.onScroll(scrolled(y)));
  expect(titleColors()).toEqual([Gallery.ink, "transparent"]);
});

it("keeps the title hidden before the first scroll and until the heading is measured", async () => {
  const { result } = await renderHook(() => useScrollTitle("Water Lilies"));
  await act(() => result.current.onScroll(scrolled(400)));
  expect(titleColors()).toEqual([]);
  await act(() => result.current.onHeadingLayout(heading(0, 30)));
  expect(titleColors()).toEqual([Gallery.ink]);
});

it("follows a renamed title", async () => {
  const view = await renderHook(({ title }: { title: string }) => useScrollTitle(title), {
    initialProps: { title: "" },
  });
  await view.rerender({ title: "Water Lilies" });
  await view.rerender({ title: "Nymphéas" });
  expect(titles()).toEqual(["", "Water Lilies", "Nymphéas"]);
});

it("measures a nested heading against the scroll view", async () => {
  const nativeScroll = {};
  const { result } = await renderHook(() => useScrollTitle("Ana Ruiz"));
  result.current.scrollRef.current = { getNativeScrollRef: () => nativeScroll } as unknown as ScrollView;
  result.current.headingRef.current = {
    measureLayout: (relativeTo: unknown, onSuccess: (...frame: number[]) => void) => {
      if (relativeTo === nativeScroll) onSuccess(20, 300, 362, 40);
    },
  } as unknown as Text;
  await act(() => result.current.measureHeading());
  await act(() => result.current.onScroll(scrolled(223)));
  expect(titleColors()).toEqual([]);
  await act(() => result.current.onScroll(scrolled(224)));
  expect(titleColors()).toEqual([Gallery.ink]);
});
