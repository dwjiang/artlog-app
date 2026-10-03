import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";

type Scrollable =
  | { scrollTo(options: { y: number; animated: boolean }): void }
  | { scrollToOffset(params: { offset: number; animated: boolean }): void };

/** A scroll view with a header above switchable panes, as `usePaneSwitch` reads and moves it. */
export type PaneRoom = {
  /** The offset where the header has scrolled away: a sticky pane switch pins here, and pane content starts. */
  pinned: number;
  offset(): number;
  scrollTo(y: number): void;
};

type PanePosition = { offset: number; pinned: number };

/**
 * Where the incoming pane opens so the header holds still: at the outgoing offset while the header shows, otherwise
 * no higher than the pinned point, so a pane already scrolled past it keeps its place.
 */
export function paneOffset(from: PanePosition, to: PanePosition) {
  // A view scrolled to the pinned point reports it back with float error, so the last half point counts as pinned.
  return from.offset < from.pinned - 0.5 ? from.offset : Math.max(to.pinned, to.offset);
}

/**
 * Measures one scroll view for `usePaneSwitch`. Its `minHeight` goes on the content container, so a pane shorter than
 * the screen can still reach the pinned point instead of dragging the header down when it opens. Attach `onLayout` and
 * `onScroll` to the scroll view, and either `onPinnedLayout` to the sticky row that holds the switch or
 * `onHeaderLayout` to the view whose bottom edge the pane content starts below. `handle` exposes the room to a parent
 * that switches between several scroll views.
 */
export function usePaneRoom(scroll: { readonly current: Scrollable | null }, handle?: Ref<PaneRoom>) {
  const [viewport, setViewport] = useState(0);
  const [pinned, setPinned] = useState(0);
  const offset = useRef(0);
  const room: PaneRoom = {
    pinned,
    offset: () => offset.current,
    scrollTo(y) {
      offset.current = y;
      const view = scroll.current;
      if (!view) return;
      if ("scrollToOffset" in view) view.scrollToOffset({ offset: y, animated: false });
      else view.scrollTo({ y, animated: false });
    },
  };
  useImperativeHandle(handle, () => room);
  return {
    ...room,
    viewport,
    minHeight: viewport > 0 ? viewport + pinned : undefined,
    onLayout: (event: LayoutChangeEvent) => setViewport(event.nativeEvent.layout.height),
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = event.nativeEvent.contentOffset.y;
    },
    onPinnedLayout: (event: LayoutChangeEvent) => setPinned(event.nativeEvent.layout.y),
    onHeaderLayout: ({ nativeEvent: { layout } }: LayoutChangeEvent) => setPinned(layout.y + layout.height),
  };
}

/**
 * Keeps the header above switchable panes still when `pane` changes. `roomOf` names the scroll view showing each pane:
 * one shared view remembers each pane's offset, while separate views keep their own.
 *
 * Fabric delivers view commands and mounts in order, but a mount carries every commit made before it runs, so the move
 * after the commit that swaps panes can land a frame after them. In one shared view the header is unmoved or pinned
 * meanwhile. A separate view would show its old offset, so call the returned `prepare(next)` before switching: it moves
 * the view while it is still hidden.
 */
export function usePaneSwitch<K extends string>(pane: K, roomOf: (pane: K) => PaneRoom | null | undefined) {
  const remembered = useRef(new Map<K, number>());
  const previous = useRef(pane);
  const prepared = useRef<K>(undefined);
  function move(from: K, to: K) {
    const source = roomOf(from);
    const target = roomOf(to);
    if (!source || !target) return;
    const offset = source.offset();
    remembered.current.set(from, offset);
    const shared = source === target;
    const current = shared ? (remembered.current.get(to) ?? target.pinned) : target.offset();
    const y = paneOffset({ offset, pinned: source.pinned }, { offset: current, pinned: target.pinned });
    // A hidden view lacks the tab bar inset, so a needless move can clamp it short of where it was.
    if (y !== (shared ? offset : current)) target.scrollTo(y);
  }
  useLayoutEffect(() => {
    const from = previous.current;
    const done = prepared.current === pane;
    previous.current = pane;
    prepared.current = undefined;
    if (from !== pane && !done) move(from, pane);
  });
  return function prepare(next: K) {
    if (next === previous.current || roomOf(next) === roomOf(previous.current)) return;
    move(previous.current, next);
    prepared.current = next;
  };
}
