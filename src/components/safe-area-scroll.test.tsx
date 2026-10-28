import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { createRef, type ReactNode } from "react";
import { Keyboard, StyleSheet, Text, type EmitterSubscription, type ScrollViewInstance } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { SafeAreaFlatList, SafeAreaScrollView } from "./safe-area-scroll";
import { scrollViewHolding } from "./scroll-view.testing";

const railOnTheRight = ({ children }: { children: ReactNode }) => (
  <SafeAreaInsetsContext.Provider value={{ top: 59, right: 84, bottom: 34, left: 0 }}>
    {children}
  </SafeAreaInsetsContext.Provider>
);

const contentStyleAround = (text: string) =>
  StyleSheet.flatten(scrollViewHolding(screen.getByText(text)).props.contentContainerStyle);

it("pads a vertical list's content across its axis when it adjusts for the safe area", async () => {
  await render(
    <SafeAreaScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 20 }}>
      <Text>Water Lilies</Text>
    </SafeAreaScrollView>,
    { wrapper: railOnTheRight },
  );
  expect(contentStyleAround("Water Lilies")).toMatchObject({ paddingLeft: 20, paddingRight: 104 });
});

it("pads list content the same way", async () => {
  await render(
    <SafeAreaFlatList
      contentInsetAdjustmentBehavior="automatic"
      data={["Water Lilies"]}
      renderItem={({ item }) => <Text>{item}</Text>}
    />,
    { wrapper: railOnTheRight },
  );
  expect(contentStyleAround("Water Lilies")).toMatchObject({ paddingLeft: 0, paddingRight: 84 });
});

it("leaves lists that do not adjust, or scroll sideways, to their own padding", async () => {
  await render(
    <>
      <SafeAreaScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ padding: 20 }}>
        <Text>Never</Text>
      </SafeAreaScrollView>
      <SafeAreaScrollView horizontal contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20 }}>
        <Text>Sideways</Text>
      </SafeAreaScrollView>
    </>,
    { wrapper: railOnTheRight },
  );
  expect(contentStyleAround("Never")).toEqual({ padding: 20 });
  expect(contentStyleAround("Sideways")).toEqual({ padding: 20 });
});

const scrollTo = (text: string, y: number) =>
  fireEvent.scroll(scrollViewHolding(screen.getByText(text)), { nativeEvent: { contentOffset: { x: 0, y } } });

it("keeps content resting below the header in place while the keyboard opens and closes", async () => {
  const onScroll = jest.fn();
  await render(
    <SafeAreaScrollView
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      onScroll={onScroll}
    >
      <Text>Search museums</Text>
    </SafeAreaScrollView>,
  );
  const overflowAllowed = () => scrollViewHolding(screen.getByText("Search museums")).props.scrollToOverflowEnabled;
  expect(overflowAllowed()).toBe(true);

  await scrollTo("Search museums", 240);
  expect(overflowAllowed()).toBe(false);

  await scrollTo("Search museums", -70);
  expect(overflowAllowed()).toBe(true);
  expect(onScroll).toHaveBeenCalledTimes(2);
});

it("leaves the keyboard offset alone in lists without automatic or keyboard insets", async () => {
  await render(
    <>
      <SafeAreaScrollView contentInsetAdjustmentBehavior="automatic">
        <Text>No keyboard</Text>
      </SafeAreaScrollView>
      <SafeAreaScrollView contentInsetAdjustmentBehavior="never" automaticallyAdjustKeyboardInsets>
        <Text>Never</Text>
      </SafeAreaScrollView>
    </>,
  );
  expect(scrollViewHolding(screen.getByText("No keyboard")).props.scrollToOverflowEnabled).toBeUndefined();
  expect(scrollViewHolding(screen.getByText("Never")).props.scrollToOverflowEnabled).toBeUndefined();
});

describe("keyboard changes during scrolling", () => {
  const listeners = new Map<string, () => void>();
  beforeEach(() => {
    jest.clearAllMocks();
    listeners.clear();
    jest.spyOn(Keyboard, "addListener").mockImplementation((event, listener) => {
      listeners.set(event, listener as () => void);
      return { remove: jest.fn() } as unknown as EmitterSubscription;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  async function renderNotes() {
    const scroll = createRef<ScrollViewInstance>();
    const onScrollBeginDrag = jest.fn();
    const onScrollEndDrag = jest.fn();
    const onLayout = jest.fn();
    await render(
      <SafeAreaScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        onLayout={onLayout}
      >
        <Text>Notes</Text>
      </SafeAreaScrollView>,
    );
    return {
      scroll,
      view: scrollViewHolding(screen.getByText("Notes")),
      onScrollBeginDrag,
      onScrollEndDrag,
      onLayout,
    };
  }
  const keyboardMoved = () => act(() => listeners.get("keyboardDidChangeFrame")?.());
  const endDrag = (y: number, target: number, velocity: number) =>
    fireEvent(scrollViewHolding(screen.getByText("Notes")), "scrollEndDrag", {
      nativeEvent: {
        contentOffset: { x: 0, y },
        targetContentOffset: { x: 0, y: target },
        velocity: { x: 0, y: velocity },
      },
    });

  it.each([-1, 0])("settles a pull past the top released at velocity %s", async (velocity) => {
    const { scroll, onScrollEndDrag } = await renderNotes();
    await scrollTo("Notes", -200);
    await endDrag(-200, -70, velocity);
    await keyboardMoved();

    expect(scroll.current?.scrollTo).toHaveBeenCalledWith({ y: -70, animated: true });
    expect(onScrollEndDrag).toHaveBeenCalledTimes(1);
  });

  it("does not mistake upward momentum below a header for the top edge", async () => {
    const { scroll } = await renderNotes();
    await scrollTo("Notes", -80);
    await endDrag(-80, -20, 0.2);
    await scrollTo("Notes", -104);
    await keyboardMoved();

    expect(scroll.current?.scrollTo).not.toHaveBeenCalled();
  });

  it("forgets a bounce once content reaches its edge", async () => {
    const { scroll } = await renderNotes();
    await endDrag(-200, -70, -1);
    await scrollTo("Notes", -70);
    // Rotation can move the resting offset farther below zero.
    await scrollTo("Notes", -104);
    await keyboardMoved();

    expect(scroll.current?.scrollTo).not.toHaveBeenCalled();
  });

  it("leaves a new drag under the user's control", async () => {
    const { scroll, view, onScrollBeginDrag } = await renderNotes();
    await scrollTo("Notes", -200);
    await endDrag(-200, -70, -1);
    await fireEvent(view, "scrollBeginDrag", { nativeEvent: { contentOffset: { x: 0, y: -200 } } });
    await keyboardMoved();

    expect(scroll.current?.scrollTo).not.toHaveBeenCalled();
    expect(onScrollBeginDrag).toHaveBeenCalledTimes(1);
  });

  it("discards a bounce destination when the viewport changes", async () => {
    const { scroll, view, onLayout } = await renderNotes();
    await scrollTo("Notes", -200);
    await endDrag(-200, -70, -1);
    await fireEvent(view, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 852, height: 393 } } });
    await keyboardMoved();

    expect(scroll.current?.scrollTo).not.toHaveBeenCalled();
    expect(onLayout).toHaveBeenCalledTimes(1);
  });
});
