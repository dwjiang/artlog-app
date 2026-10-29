import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet, useWindowDimensions } from "react-native";
import { State, type LegacyPinchGesture } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";

import { knownImageSize } from "@/lib/ui/image-sizes";

import { PhotoViewer, PhotoViewerButton } from "./photo-viewer";

jest.mock("@/lib/ui/image-sizes", () => ({ knownImageSize: jest.fn(), rememberImageSize: jest.fn() }));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 402, height: 874, scale: 3, fontScale: 1 })),
}));
jest.mock("react-native-reanimated", () => {
  const reanimated = jest.requireActual("react-native-reanimated/mock");
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    ...reanimated,
    __esModule: true,
    default: { ...reanimated.default, View: jest.requireActual("react-native").View },
    useSharedValue: (initial: unknown) => React.useState(() => reanimated.useSharedValue(initial))[0],
    useAnimatedStyle: (style: () => unknown) => style(),
  };
});
jest.mock("react-native-worklets", () => ({
  ...jest.requireActual("react-native-worklets/lib/module/mock"),
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
  scheduleOnUI: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));

const onClose = jest.fn();
const onDetails = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(knownImageSize).mockReturnValue(undefined);
  jest.mocked(useWindowDimensions).mockReturnValue({ width: 402, height: 874, scale: 3, fontScale: 1 });
});

function renderViewer(visible: boolean) {
  return render(
    <PhotoViewer
      visible={visible}
      uri="file:///photos/water-lilies.jpg"
      label="Your photo of Water Lilies"
      onClose={onClose}
      actions={<PhotoViewerButton icon="info.circle" label="Photo details" onPress={onDetails} />}
    />,
  );
}

it("shows the photo full screen only while open, with Close and the given actions", async () => {
  const view = await renderViewer(false);
  expect(screen.queryByRole("image", { name: "Your photo of Water Lilies" })).toBeNull();
  await view.rerender(
    <PhotoViewer
      visible
      uri="file:///photos/water-lilies.jpg"
      label="Your photo of Water Lilies"
      onClose={onClose}
      actions={<PhotoViewerButton icon="info.circle" label="Photo details" onPress={onDetails} />}
    />,
  );
  expect(screen.getByRole("image", { name: "Your photo of Water Lilies" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Photo details" }));
  expect(onDetails).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("closes with the VoiceOver escape gesture and offers zoom without pinching", async () => {
  await renderViewer(true);
  const photo = screen.getByRole("image", { name: "Your photo of Water Lilies" });
  expect(photo.props.accessibilityActions.map((action: { label: string }) => action.label)).toEqual([
    "Zoom in",
    "Zoom out",
  ]);
  await fireEvent(photo, "accessibilityEscape");
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("says so when the photo can't load", async () => {
  await renderViewer(true);
  const photo = screen.getByRole("image", { name: "Your photo of Water Lilies" });
  const image = (photo.children[0] as typeof photo).children[0] as typeof photo;
  await fireEvent(image, "error", { nativeEvent: { error: "Missing file" } });
  expect(screen.getByText("Photo unavailable")).toBeOnTheScreen();
});

it.each([
  { shape: "wide", axis: "x", sign: 1 },
  { shape: "wide", axis: "x", sign: -1 },
  { shape: "tall", axis: "y", sign: 1 },
  { shape: "tall", axis: "y", sign: -1 },
])("keeps a zoomed $shape photo visible after rotating from the $sign edge", async ({ axis, sign }) => {
  const horizontal = axis === "x";
  const before = { width: horizontal ? 874 : 402, height: horizontal ? 402 : 874, scale: 3, fontScale: 1 };
  jest.mocked(useWindowDimensions).mockReturnValue(before);
  jest.mocked(knownImageSize).mockReturnValue({ width: horizontal ? 4000 : 1000, height: horizontal ? 1000 : 4000 });
  const viewer = () => <PhotoViewer visible uri="file:///photo.jpg" label="Photo" onClose={onClose} />;
  const view = await render(viewer());
  const focal = { focalX: before.width / 2, focalY: before.height / 2 };
  await act(() =>
    fireGestureHandler<LegacyPinchGesture>(getByGestureTestId("photo-viewer-pinch"), [
      { state: State.BEGAN, scale: 1, ...focal },
      { state: State.ACTIVE, scale: 1, ...focal },
      {
        state: State.ACTIVE,
        scale: 4,
        focalX: focal.focalX + (horizontal ? sign * 1311 : 0),
        focalY: focal.focalY + (horizontal ? 0 : sign * 1311),
      },
      { state: State.END },
    ]),
  );
  const transform = () => {
    const photo = screen.getByRole("image", { name: "Photo" });
    return StyleSheet.flatten((photo.children[0] as typeof photo).props.style).transform;
  };
  await view.rerender(viewer());
  expect(transform()).toEqual([
    { translateX: horizontal ? sign * 1311 : 0 },
    { translateY: horizontal ? 0 : sign * 1311 },
    { scale: 4 },
  ]);

  jest.mocked(useWindowDimensions).mockReturnValue({ ...before, width: before.height, height: before.width });
  await view.rerender(viewer());
  // The animation mock evaluates styles on render, rather than when shared values change in the layout effect.
  await view.rerender(viewer());
  expect(transform()).toEqual([
    { translateX: horizontal ? sign * 603 : 0 },
    { translateY: horizontal ? 0 : sign * 603 },
    { scale: 4 },
  ]);
  expect(onClose).not.toHaveBeenCalled();
});
