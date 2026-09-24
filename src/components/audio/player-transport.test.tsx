import { fireEvent, render, screen } from "@testing-library/react-native";
import { PlayerTransport } from "./player-transport";

const mockSeek = jest.fn();
jest.mock("@/lib/audio/use-listening", () => ({
  useListening: () => ({
    position: 12,
    duration: 120,
    phase: "ready",
    playing: false,
    rate: 1,
    controller: { seek: mockSeek },
  }),
}));
jest.mock("@react-native-community/slider", () => {
  const { View } = jest.requireActual("react-native");
  return function MockSlider(props: object) {
    return <View accessible accessibilityRole="adjustable" {...props} />;
  };
});

beforeEach(() => jest.clearAllMocks());

it("previews the drag position and seeks once to the final released value", async () => {
  await render(<PlayerTransport view="player" onView={jest.fn()} />);
  const slider = screen.getByRole("adjustable", { name: "Narration position" });
  await fireEvent(slider, "slidingStart", 12);
  await fireEvent(slider, "valueChange", 45);
  expect(screen.getByText("0:45")).toBeOnTheScreen();
  expect(screen.getByText("−1:15")).toBeOnTheScreen();
  expect(mockSeek).not.toHaveBeenCalled();
  await fireEvent(slider, "slidingComplete", 48);
  expect(mockSeek).toHaveBeenCalledTimes(1);
  expect(mockSeek).toHaveBeenCalledWith(48);
});

it("seeks when accessibility changes the value without a touch gesture", async () => {
  await render(<PlayerTransport view="player" onView={jest.fn()} />);
  await fireEvent(screen.getByRole("adjustable", { name: "Narration position" }), "valueChange", 18);
  expect(mockSeek).toHaveBeenCalledWith(18);
});

it("supports VoiceOver adjustments for position", async () => {
  await render(<PlayerTransport view="player" onView={jest.fn()} />);
  await fireEvent(screen.getByRole("adjustable", { name: "Narration position" }), "accessibilityAction", {
    nativeEvent: { actionName: "increment" },
  });
  expect(mockSeek).toHaveBeenCalledWith(27);
});

it("marks transcript selection and returns to the artwork when tapped again", async () => {
  const onView = jest.fn();
  await render(<PlayerTransport view="transcript" onView={onView} />);
  const transcript = screen.getByRole("button", {
    name: "Transcript and sources",
    selected: true,
  });
  await fireEvent.press(transcript);
  expect(onView).toHaveBeenCalledWith("player");
});

it("keeps Up next selected while adding saved artworks", async () => {
  const onView = jest.fn();
  await render(<PlayerTransport view="saved" onView={onView} />);
  await fireEvent.press(screen.getByRole("button", { name: "Up next", selected: true }));
  expect(onView).toHaveBeenCalledWith("player");
});
