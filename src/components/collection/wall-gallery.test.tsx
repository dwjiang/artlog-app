import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { State, type PanGesture } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";

import type { WallPiece } from "@/lib/wall/wall-layout";

import { WallGallery } from "./wall-gallery";

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: {
    View: jest.requireActual("react-native").View,
    createAnimatedComponent: (component: unknown) => component,
  },
  useAnimatedStyle: (style: () => unknown) => style(),
  useEvent: () => jest.fn(),
  useSharedValue: (initial: unknown) => {
    const value = jest.requireActual("react").useRef(initial);
    return {
      get: () => value.current,
      set: (next: unknown) => {
        value.current = next;
      },
    };
  },
}));
jest.mock("react-native-worklets", () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));
jest.mock("@/lib/files/photos", () => ({
  captureFileUri: (path: string) => `file:///${path}`,
}));

const piece: WallPiece = {
  localId: "art",
  cropPath: "painting.jpg",
  layout: { x: 0.1, y: 0.1, width: 0.4, layer: 0, frame: "gilt" },
  artwork: {
    title: "Water Lilies",
    artist: "Claude Monet",
    media: { kind: "placeholder", width: 1, height: 1 },
  },
};

it("opens artwork without a numbered wall label", async () => {
  const onSelect = jest.fn();
  await render(<WallGallery pieces={[piece]} wallpaper={{ color: "#FCFCF9" }} width={390} onSelect={onSelect} />);
  expect(screen.queryByText("1")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Water Lilies, Claude Monet" }));
  expect(onSelect).toHaveBeenCalledWith(piece);
});

it("keeps accessible resizing on the selected wall artwork", async () => {
  const onMove = jest.fn();
  await render(
    <WallGallery
      pieces={[piece]}
      wallpaper={{ color: "#FCFCF9" }}
      width={390}
      editing
      selectedId="art"
      onSelect={jest.fn()}
      onMove={onMove}
    />,
  );
  await fireEvent(screen.getByRole("adjustable", { name: "Water Lilies, Claude Monet" }), "accessibilityAction", {
    nativeEvent: { actionName: "increment" },
  });
  expect(onMove).toHaveBeenCalledWith("art", { ...piece.layout, width: 0.44 });
});

it.each(["top-left", "top-right", "bottom-left", "bottom-right"] as const)(
  "commits a resize from %s only when the drag ends",
  async (corner) => {
    const onMove = jest.fn();
    await render(
      <WallGallery
        pieces={[piece]}
        wallpaper={{ color: "#FCFCF9" }}
        width={390}
        editing
        selectedId="art"
        onSelect={jest.fn()}
        onMove={onMove}
      />,
    );
    const x = corner.endsWith("left") ? -20 : 20;
    const y = corner.startsWith("top") ? -20 : 20;
    await act(() =>
      fireGestureHandler<PanGesture>(getByGestureTestId(`resize-art-${corner}`), [
        { state: State.BEGAN, translationX: 0, translationY: 0 },
        { state: State.ACTIVE, translationX: x / 2, translationY: y / 2 },
        { state: State.ACTIVE, translationX: x, translationY: y },
        { state: State.END, translationX: x, translationY: y },
      ]),
    );
    expect(onMove).toHaveBeenCalledTimes(1);
    const [, next] = onMove.mock.calls[0];
    expect(next.width).toBeCloseTo(0.4 + 20 / 390);
    expect(next.x).toBeCloseTo(0.1 - (corner.endsWith("left") ? 20 / 390 : 0));
    expect(next.y).toBeCloseTo(0.1 - (corner.startsWith("top") ? 20 / 390 : 0));
  },
);

it("does not save a cancelled resize, and a later drag starts at the original size", async () => {
  const onMove = jest.fn();
  await render(
    <WallGallery
      pieces={[piece]}
      wallpaper={{ color: "#FCFCF9" }}
      width={390}
      editing
      selectedId="art"
      onSelect={jest.fn()}
      onMove={onMove}
    />,
  );
  const resize = getByGestureTestId("resize-art-bottom-right");
  await act(() =>
    fireGestureHandler<PanGesture>(resize, [
      { state: State.BEGAN },
      { state: State.ACTIVE, translationX: 60, translationY: 60 },
      { state: State.CANCELLED },
    ]),
  );
  expect(onMove).not.toHaveBeenCalled();
  await act(() =>
    fireGestureHandler<PanGesture>(resize, [
      { state: State.BEGAN },
      { state: State.ACTIVE, translationX: 10, translationY: 10 },
      { state: State.END, translationX: 10, translationY: 10 },
    ]),
  );
  expect(onMove.mock.calls[0][1].width).toBeCloseTo(0.4 + 10 / 390);
});

it("deselects from empty wall space and keeps movement accessible without visible corner buttons", async () => {
  const onDeselect = jest.fn();
  const onMove = jest.fn();
  await render(
    <WallGallery
      pieces={[piece]}
      wallpaper={{ color: "#FCFCF9" }}
      width={390}
      editing
      selectedId="art"
      onSelect={jest.fn()}
      onDeselect={onDeselect}
      onMove={onMove}
    />,
  );
  await fireEvent(screen.getByRole("adjustable", { name: "Water Lilies, Claude Monet" }), "accessibilityAction", {
    nativeEvent: { actionName: "moveRight" },
  });
  expect(onMove).toHaveBeenCalledWith("art", { ...piece.layout, x: 0.125 });
  expect(screen.queryByRole("button", { name: /Remove|Take off|Artwork size/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Deselect artwork" }));
  expect(onDeselect).toHaveBeenCalledTimes(1);
});
