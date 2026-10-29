import { act, renderHook } from "@testing-library/react-native";
import {
  DeviceEventEmitter,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
  type TextInputChangeEvent,
  type ViewInstance,
} from "react-native";

import { revealOffset, useKeyboardReveal } from "./use-keyboard-reveal";

jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 116 }));

// An iPhone 17 Pro page under a 116-point bar with the keyboard's top at 540; the content rests at offset -116.
const page = { barBottom: 116, keyboardTop: 540, margin: 12 };

describe("revealOffset", () => {
  it("scrolls a region the keyboard covers just far enough to show its bottom above the keyboard", () => {
    for (const keep of ["top", "bottom", "nearest"] as const) {
      expect(revealOffset({ ...page, keep, offset: -116, top: 420, bottom: 640 })).toBe(112);
    }
  });

  it("leaves the page still when the region already shows between the bar and the keyboard", () => {
    expect(revealOffset({ ...page, keep: "top", offset: 200, top: 420, bottom: 640 })).toBe(200);
    expect(revealOffset({ ...page, keep: "top", offset: -116, top: 100, bottom: 300 })).toBe(-116);
  });

  it("brings back a region scrolled up under the bar", () => {
    expect(revealOffset({ ...page, keep: "top", offset: 400, top: 420, bottom: 640 })).toBe(292);
  });

  it("never pulls the content below where it rests under the bar", () => {
    expect(revealOffset({ ...page, keep: "top", offset: -116, top: 0, bottom: 200 })).toBe(-116);
  });

  describe("a region taller than the gap", () => {
    const tall = { ...page, top: 420, bottom: 1000 };

    it("puts its top under the bar or its bottom above the keyboard, whatever the current offset", () => {
      for (const offset of [-116, 380, 700]) {
        expect(revealOffset({ ...tall, offset, keep: "top" })).toBe(292);
        expect(revealOffset({ ...tall, offset, keep: "bottom" })).toBe(472);
      }
    });

    it("moves as little as possible to fill the gap with the nearest part", () => {
      expect(revealOffset({ ...tall, offset: 380, keep: "nearest" })).toBe(380);
      expect(revealOffset({ ...tall, offset: -116, keep: "nearest" })).toBe(292);
      expect(revealOffset({ ...tall, offset: 700, keep: "nearest" })).toBe(472);
    });
  });
});

describe("useKeyboardReveal", () => {
  const scrolled = (y: number) =>
    ({ nativeEvent: { contentOffset: { x: 0, y } } }) as NativeSyntheticEvent<NativeScrollEvent>;
  const typed = (text: string, caret = text.length) =>
    ({ nativeEvent: { text, selection: { start: caret, end: caret } } }) as TextInputChangeEvent;
  const keyboard = (event: "keyboardDidShow" | "keyboardDidHide") =>
    act(() =>
      DeviceEventEmitter.emit(event, {
        duration: 250,
        easing: "keyboard",
        startCoordinates: { screenX: 0, screenY: 874, width: 402, height: 334 },
        endCoordinates: { screenX: 0, screenY: page.keyboardTop, width: 402, height: 334 },
      }),
    );

  let region: { top: number; height: number };
  const scrollTo = jest.fn();
  const render = async (active = true) => {
    const view = await renderHook(({ focused }: { focused: boolean }) => useKeyboardReveal(focused), {
      initialProps: { focused: active },
    });
    const content = {};
    view.result.current.scrollRef.current = {
      getNativeScrollRef: () => content,
      scrollTo,
    } as unknown as ScrollViewInstance;
    view.result.current.regionRef.current = {
      measureLayout: (relativeTo: unknown, onSuccess: (...frame: number[]) => void) => {
        if (relativeTo === content) onSuccess(20, region.top, 362, region.height);
      },
    } as unknown as ViewInstance;
    return view;
  };
  const scrolledTo = () => scrollTo.mock.calls.map(([{ y }]) => y);

  beforeEach(() => {
    scrollTo.mockClear();
    region = { top: 420, height: 160 };
  });
  afterEach(() => keyboard("keyboardDidHide"));

  it("shows the focused caption once the keyboard rises", async () => {
    await render();
    await keyboard("keyboardDidShow");
    expect(scrolledTo()).toEqual([52]);
  });

  it("brings a caption dragged behind the keyboard back above it as the person types", async () => {
    const { result } = await render();
    await keyboard("keyboardDidShow");
    await act(() => result.current.onScroll(scrolled(52)));
    await act(() => result.current.onScroll(scrolled(-116)));
    await act(() => result.current.onFieldChange(typed("Sunlit room, l")));
    expect(scrolledTo()).toEqual([52, 52]);
  });

  it("brings a caption scrolled up under the bar back down as the person types", async () => {
    const { result } = await render();
    await keyboard("keyboardDidShow");
    await act(() => result.current.onScroll(scrolled(600)));
    await act(() => result.current.onFieldChange(typed("Sunlit room, l")));
    expect(scrolledTo()).toEqual([52, 292]);
  });

  it("leaves the page still while the person types in a caption that shows", async () => {
    const { result } = await render();
    await keyboard("keyboardDidShow");
    await act(() => result.current.onScroll(scrolled(52)));
    scrollTo.mockClear();
    await act(() => result.current.onFieldChange(typed("Sunlit room, l")));
    expect(scrolledTo()).toEqual([]);
  });

  it("keeps the last line above the keyboard as a long caption grows at its end", async () => {
    const { result } = await render();
    region = { top: 420, height: 580 };
    await keyboard("keyboardDidShow");
    await act(() => result.current.onScroll(scrolled(292)));
    await act(() => result.current.onFieldChange(typed("line1\nline2")));
    region = { top: 420, height: 605 };
    await act(() => result.current.onFieldContentSizeChange());
    expect(scrolledTo()).toEqual([292, 472, 497]);
  });

  it("leaves a long caption filling the gap in place while the person types inside it", async () => {
    const { result } = await render();
    region = { top: 420, height: 580 };
    await keyboard("keyboardDidShow");
    await act(() => result.current.onScroll(scrolled(380)));
    await act(() => result.current.onFieldChange(typed("line1\nline2", 3)));
    await act(() => result.current.onFieldContentSizeChange());
    expect(scrolledTo()).toEqual([292]);
  });

  it("leaves the page alone while the caption isn't focused or the keyboard is down", async () => {
    const view = await render(false);
    await keyboard("keyboardDidShow");
    await act(() => view.result.current.onFieldChange(typed("Sunlit room")));
    expect(scrolledTo()).toEqual([]);
    await keyboard("keyboardDidHide");
    await view.rerender({ focused: true });
    await act(() => view.result.current.onFieldChange(typed("Sunlit room")));
    await act(() => view.result.current.onFieldContentSizeChange());
    expect(scrolledTo()).toEqual([]);
  });
});
