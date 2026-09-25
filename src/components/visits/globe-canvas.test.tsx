import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { GlobeCanvas } from "./globe-canvas";

let mockImage: object | null = null;
let mockImageError: () => void;
jest.mock("@shopify/react-native-skia", () => {
  const { View } = jest.requireActual("react-native");
  return {
    Canvas: View,
    Circle: View,
    Fill: View,
    Group: View,
    ImageShader: View,
    RoundedRect: View,
    Shader: View,
    Text: View,
    Skia: { RuntimeEffect: { Make: () => ({}) } },
    matchFont: () => ({}),
    useImage: (_asset: unknown, onError: () => void) => {
      mockImageError = onError;
      return mockImage;
    },
  };
});
jest.mock("react-native-reanimated", () => ({
  useDerivedValue: (get: () => unknown) => ({ get }),
}));
jest.mock("react-native-worklets", () => ({ scheduleOnRN: jest.fn() }));
jest.mock("react-native-gesture-handler", () => {
  const { View } = jest.requireActual("react-native");
  const gesture = {
    onBegin: () => gesture,
    onEnd: () => gesture,
    numberOfTaps: () => gesture,
  };
  return {
    GestureHandlerRootView: View,
    GestureDetector: View,
    Gesture: {
      Tap: () => gesture,
      Race: jest.fn(),
      Simultaneous: jest.fn(),
      Exclusive: jest.fn(),
    },
  };
});
jest.mock("./use-globe-camera", () => ({
  useGlobeCamera: () => ({
    camera: { get: () => ({ yaw: 0, pitch: 0, zoom: 1 }) },
  }),
}));
jest.mock("@/components/loading-ring", () => {
  const { View } = jest.requireActual("react-native");
  return {
    LoadingRing: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
      <View accessible accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel} />
    ),
  };
});
const props = {
  pins: [],
  selectedId: "",
  initialPin: { id: "museum", latitude: 0, longitude: 0, label: "Museum" },
  height: 337,
  onSelect: jest.fn(),
};
beforeEach(() => {
  mockImage = null;
});

it("shows a spinner without raw loading text until the map image and layout are ready", async () => {
  const view = await render(<GlobeCanvas {...props} />);
  expect(screen.getByRole("progressbar", { name: "Loading globe…" })).toBeOnTheScreen();
  expect(screen.queryByText("Loading globe…")).toBeNull();
  await fireEvent(screen.getByLabelText("Interactive globe of your museum visits"), "layout", {
    nativeEvent: { layout: { width: 350 } },
  });
  mockImage = {};
  await view.rerender(<GlobeCanvas {...props} />);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(
    screen.getByRole("image", {
      name: "Interactive globe of your museum visits",
    }),
  ).toBeOnTheScreen();
});

it("replaces a failed image load with the existing list recovery guidance", async () => {
  await render(<GlobeCanvas {...props} />);
  await act(() => mockImageError());
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText("Globe rendering is unavailable. Use the museum chooser or List.")).toBeOnTheScreen();
});

it("lets VoiceOver open any museum through the globe's actions", async () => {
  mockImage = {};
  const onSelect = jest.fn();
  const pins = [
    { id: "met", latitude: 40, longitude: -73, label: "The Met" },
    { id: "louvre", latitude: 48, longitude: 2, label: "Louvre" },
  ];
  await render(<GlobeCanvas {...props} pins={pins} initialPin={pins[0]} onSelect={onSelect} />);
  const globe = screen.getByLabelText("Interactive globe of your museum visits");
  await fireEvent(globe, "layout", { nativeEvent: { layout: { width: 350 } } });
  expect(
    screen
      .getByRole("image", { name: "Interactive globe of your museum visits" })
      .props.accessibilityActions.map((action: { label: string }) => action.label),
  ).toEqual(["Open visits to The Met", "Open visits to Louvre"]);
  await fireEvent(globe, "accessibilityAction", { nativeEvent: { actionName: "louvre" } });
  expect(onSelect).toHaveBeenCalledWith("louvre");
});
