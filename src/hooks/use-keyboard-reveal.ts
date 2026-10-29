import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useEffectEvent, useRef } from "react";
import {
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
  type TextInputChangeEvent,
  type ViewInstance,
} from "react-native";

/** The part of a region too tall for the gap between the bar and the keyboard that stays in view. */
export type RevealKeep = "top" | "bottom" | "nearest";

/**
 * The scroll offset closest to `offset` that shows the content between `top` and `bottom` below the bar and above the
 * keyboard. A region that can't fit fills the gap instead, showing its `keep` edge, or moving as little as possible
 * for `nearest`. Lower offsets would pull the content below its resting place under the bar. The scroll view fills the
 * screen, so content and screen positions differ only by the offset.
 */
export function revealOffset({
  offset,
  top,
  bottom,
  barBottom,
  keyboardTop,
  margin,
  keep,
}: {
  offset: number;
  top: number;
  bottom: number;
  barBottom: number;
  keyboardTop: number;
  margin: number;
  keep: RevealKeep;
}) {
  const showsBottom = bottom + margin - keyboardTop;
  const showsTop = top - barBottom - margin;
  const fits = showsBottom <= showsTop;
  const y =
    fits || keep === "nearest"
      ? Math.min(Math.max(offset, Math.min(showsBottom, showsTop)), Math.max(showsBottom, showsTop))
      : keep === "top"
        ? showsTop
        : showsBottom;
  return Math.max(-barBottom, y);
}

/**
 * Field handlers that call `reveal` whenever a multiline field's text or height changes, since React Native reveals
 * only the caret line, and only when the keyboard moves. `atEnd` says whether the caret is on the field's last line;
 * elsewhere, its line is unknown.
 */
export function useTypingReveal(reveal: (atEnd: boolean) => void) {
  const atEnd = useRef(false);
  return {
    onFieldChange: ({ nativeEvent: { text, selection } }: TextInputChangeEvent) => {
      atEnd.current = (selection?.end ?? text.length) >= text.length;
      reveal(atEnd.current);
    },
    // A line added or removed changes the field's height only after the change event, so this reveals its new size.
    onFieldContentSizeChange: () => reveal(atEnd.current),
  };
}

/**
 * While `active`, scrolls the full-screen scroll view on `scrollRef` so the region on `regionRef` (a focused field and
 * its label) sits between the bar and the keyboard: once the keyboard shows, and again as the person types. Spread
 * `onScroll` on the scroll view and the field handlers on the field; destructure the result, since the React Compiler
 * skips a component that reads refs off the returned object.
 */
export function useKeyboardReveal(active: boolean) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const regionRef = useRef<ViewInstance>(null);
  const offset = useRef<number>(undefined);
  const barBottom = useHeaderHeight();
  const reveal = (keyboardTop: number, keep: RevealKeep) => {
    const scroll = scrollRef.current;
    const content = scroll?.getNativeScrollRef();
    if (!scroll || !content) return;
    regionRef.current?.measureLayout(content, (_left, top, _width, height) => {
      const current = offset.current ?? -barBottom;
      const y = revealOffset({
        offset: current,
        top,
        bottom: top + height,
        barBottom,
        keyboardTop,
        margin: 12,
        keep,
      });
      if (y !== current) scroll.scrollTo({ y, animated: true });
    });
  };
  const revealOnShow = useEffectEvent((keyboardTop: number) => reveal(keyboardTop, "top"));
  useEffect(() => {
    if (!active) return;
    const subscription = Keyboard.addListener("keyboardDidShow", ({ endCoordinates }) =>
      revealOnShow(endCoordinates.screenY),
    );
    return () => subscription.remove();
  }, [active]);
  const { onFieldChange, onFieldContentSizeChange } = useTypingReveal((atEnd) => {
    const keyboard = Keyboard.metrics();
    if (active && keyboard) reveal(keyboard.screenY, atEnd ? "bottom" : "nearest");
  });
  return {
    scrollRef,
    regionRef,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = event.nativeEvent.contentOffset.y;
    },
    onFieldChange,
    onFieldContentSizeChange,
  };
}
