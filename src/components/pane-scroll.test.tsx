import { act, renderHook } from "@testing-library/react-native";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";

import { paneOffset, usePaneRoom, usePaneSwitch, type PaneRoom } from "./pane-scroll";

const layout = (y: number, height: number) =>
  ({ nativeEvent: { layout: { x: 0, y, width: 402, height } } }) as LayoutChangeEvent;
const scrolled = (y: number) =>
  ({ nativeEvent: { contentOffset: { x: 0, y } } }) as NativeSyntheticEvent<NativeScrollEvent>;
const scrollView = () => ({ current: { scrollTo: jest.fn() } });

describe("paneOffset", () => {
  it("keeps the offset while the header still shows", () => {
    expect(paneOffset({ offset: 120, pinned: 300 }, { offset: 0, pinned: 300 })).toBe(120);
  });

  it("opens under the pinned switch once the header has scrolled away, or at the pane's own place below it", () => {
    expect(paneOffset({ offset: 900, pinned: 300 }, { offset: 0, pinned: 300 })).toBe(300);
    expect(paneOffset({ offset: 900, pinned: 300 }, { offset: 640, pinned: 300 })).toBe(640);
  });

  it("counts a view scrolled to the pinned point as pinned despite float error", () => {
    expect(paneOffset({ offset: 228.66666, pinned: 228.66667 }, { offset: 300, pinned: 228.66667 })).toBe(300);
  });
});

describe("usePaneRoom", () => {
  it("makes room for the header to scroll away once the viewport is measured", async () => {
    const { result } = await renderHook(() => usePaneRoom(scrollView()));
    expect(result.current.minHeight).toBeUndefined();
    await act(() => result.current.onLayout(layout(0, 700)));
    await act(() => result.current.onPinnedLayout(layout(310, 60)));
    expect(result.current.pinned).toBe(310);
    expect(result.current.minHeight).toBe(1010);
    await act(() => result.current.onHeaderLayout(layout(0, 250)));
    expect(result.current.pinned).toBe(250);
    expect(result.current.minHeight).toBe(950);
  });

  it("gives an empty pane no extra room, so its empty state scrolls only when it overflows", async () => {
    const { result } = await renderHook(() => usePaneRoom(scrollView(), { empty: true }));
    await act(() => result.current.onLayout(layout(0, 700)));
    await act(() => result.current.onPinnedLayout(layout(310, 60)));
    expect(result.current.minHeight).toBeUndefined();
  });
});

describe("usePaneSwitch", () => {
  async function renderSharedView() {
    const scroll = scrollView();
    const view = await renderHook(
      ({ pane }: { pane: string }) => {
        const room = usePaneRoom(scroll, { empty: pane === "empty" });
        const prepare = usePaneSwitch(pane, () => room);
        return { ...room, prepare };
      },
      { initialProps: { pane: "friends" } },
    );
    await act(() => view.result.current.onPinnedLayout(layout(300, 60)));
    return { ...view, scrollTo: scroll.current.scrollTo };
  }

  it("leaves the moves within one scroll view to the switch itself", async () => {
    const { result, scrollTo } = await renderSharedView();
    await act(() => result.current.onScroll(scrolled(900)));
    await act(() => result.current.prepare("global"));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("leaves one scroll view where it is while the header still shows", async () => {
    const { result, rerender, scrollTo } = await renderSharedView();
    await act(() => result.current.onScroll(scrolled(120)));
    await rerender({ pane: "global" });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("returns each pane to its own place below the pinned switch", async () => {
    const { result, rerender, scrollTo } = await renderSharedView();
    await act(() => result.current.onScroll(scrolled(900)));
    await rerender({ pane: "global" });
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 300, animated: false });
    await act(() => result.current.onScroll(scrolled(1400)));
    await rerender({ pane: "friends" });
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 900, animated: false });
  });

  it("leaves an empty pane where it rests rather than pinning the switch", async () => {
    const { result, rerender, scrollTo } = await renderSharedView();
    await act(() => result.current.onScroll(scrolled(900)));
    await rerender({ pane: "empty" });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  async function renderSeparateViews({ emptyVisits = false } = {}) {
    const wallScroll = scrollView();
    const visitsList = { current: { scrollToOffset: jest.fn() } };
    const view = await renderHook(
      ({ pane }: { pane: "wall" | "visits" }) => {
        const wall = usePaneRoom(wallScroll);
        const visits = usePaneRoom(visitsList, { empty: emptyVisits });
        const rooms: Record<string, PaneRoom> = { wall, visits };
        const prepare = usePaneSwitch(pane, (key) => rooms[key]);
        return { wall, visits, prepare };
      },
      { initialProps: { pane: "wall" as "wall" | "visits" } },
    );
    await act(() => {
      view.result.current.wall.onPinnedLayout(layout(300, 60));
      view.result.current.visits.onHeaderLayout(layout(0, 300));
      view.result.current.wall.onScroll(scrolled(83));
    });
    return { ...view, wallScroll: wallScroll.current.scrollTo, visitsScroll: visitsList.current.scrollToOffset };
  }

  it("moves the incoming scroll view to the outgoing header position", async () => {
    const { result, rerender, wallScroll, visitsScroll } = await renderSeparateViews();
    await rerender({ pane: "visits" });
    expect(visitsScroll).toHaveBeenLastCalledWith({ offset: 83, animated: false });
    await act(() => result.current.visits.onScroll(scrolled(0)));
    await rerender({ pane: "wall" });
    expect(wallScroll).toHaveBeenLastCalledWith({ y: 0, animated: false });
  });

  it("moves a hidden scroll view before the switch reveals it, and only once", async () => {
    const { result, rerender, visitsScroll } = await renderSeparateViews();
    await act(() => result.current.prepare("visits"));
    expect(visitsScroll).toHaveBeenCalledWith({ offset: 83, animated: false });
    await rerender({ pane: "visits" });
    expect(visitsScroll).toHaveBeenCalledTimes(1);
  });

  it("leaves an empty scroll view at rest when it is switched in", async () => {
    const { result, rerender, visitsScroll } = await renderSeparateViews({ emptyVisits: true });
    await act(() => result.current.prepare("visits"));
    await rerender({ pane: "visits" });
    expect(visitsScroll).not.toHaveBeenCalled();
  });
});
