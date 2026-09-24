import { fireEvent, render, screen } from "@testing-library/react-native";

import type { WallPiece } from "@/lib/wall/wall-layout";

import { WallGallery } from "./wall-gallery";

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  useAnimatedStyle: (style: () => unknown) => style(),
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
jest.mock("react-native-gesture-handler", () => {
  const pan = () => {
    const gesture = {
      enabled: () => gesture,
      activateAfterLongPress: () => gesture,
      blocksExternalGesture: () => gesture,
      onStart: () => gesture,
      onUpdate: () => gesture,
      onEnd: () => gesture,
      onFinalize: () => gesture,
    };
    return gesture;
  };
  return {
    Gesture: { Pan: pan },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});
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
  await render(<WallGallery pieces={[piece]} color="#FCFCF9" width={390} onSelect={onSelect} />);
  expect(screen.queryByText("1")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Water Lilies, Claude Monet" }));
  expect(onSelect).toHaveBeenCalledWith(piece);
});

it("keeps accessible resizing on the selected wall artwork", async () => {
  const onMove = jest.fn();
  await render(
    <WallGallery
      pieces={[piece]}
      color="#FCFCF9"
      width={390}
      editing
      selectedId="art"
      onSelect={jest.fn()}
      onMove={onMove}
    />,
  );
  await fireEvent(screen.getByRole("adjustable", { name: "Artwork size" }), "accessibilityAction", {
    nativeEvent: { actionName: "increment" },
  });
  expect(onMove).toHaveBeenCalledWith("art", { ...piece.layout, width: 0.44 });
});
