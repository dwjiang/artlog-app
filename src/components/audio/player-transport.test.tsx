import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import type { NarrationPreparationStage } from "@/lib/audio/narration-preparation";

import { PlayerTransport, transportStacks } from "./player-transport";

const mockSeek = jest.fn();
const mockToggle = jest.fn();
const mockAudio = {
  duration: 120,
  availableDuration: 0,
  phase: "ready",
  preparationStage: undefined as NarrationPreparationStage | undefined,
};
jest.mock("@/lib/audio/use-listening", () => ({
  useListening: () => ({
    position: 12,
    duration: mockAudio.duration,
    availableDuration: mockAudio.availableDuration,
    phase: mockAudio.phase,
    preparationStage: mockAudio.preparationStage,
    playing: true,
    rate: 1,
    controller: { seek: mockSeek, toggle: mockToggle },
  }),
}));
jest.mock("@react-native-community/slider", () => {
  const { View } = jest.requireActual("react-native");
  return function MockSlider(props: object) {
    return <View accessible accessibilityRole="adjustable" {...props} />;
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAudio.duration = 120;
  mockAudio.availableDuration = 0;
  mockAudio.phase = "ready";
  mockAudio.preparationStage = undefined;
});

it("keeps the controls in place with a busy play button and no loading caption or timer", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  mockAudio.phase = "loading";
  mockAudio.preparationStage = "generating";
  const { rerender } = await render(<PlayerTransport view="player" onView={jest.fn()} />);
  const play = screen.getByRole("button", { name: "Generating narration…" });
  expect(play).toBeBusy();
  expect(play).toBeDisabled();
  await fireEvent.press(play);
  expect(mockToggle).not.toHaveBeenCalled();
  expect(screen.getByRole("adjustable", { name: "Narration position" })).toHaveProp("disabled", true);
  expect(screen.getByRole("button", { name: "Back 15 seconds" })).toBeDisabled();
  expect(screen.queryByText("Generating narration…")).toBeNull();
  expect(screen.queryByText(/keep exploring|elapsed/)).toBeNull();
  expect(screen.getByRole("button", { name: "Transcript and sources" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Up next" })).toBeOnTheScreen();
  expect(announce).toHaveBeenCalledWith("Generating narration…");
  mockAudio.preparationStage = "buffering";
  await rerender(<PlayerTransport view="player" onView={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Starting audio…" })).toBeBusy();
  expect(announce).toHaveBeenLastCalledWith("Starting audio…");
  mockAudio.phase = "ready";
  mockAudio.preparationStage = undefined;
  await rerender(<PlayerTransport view="player" onView={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Pause narration" })).toBeEnabled();
  expect(screen.getByRole("adjustable", { name: "Narration position" })).toHaveProp("disabled", false);
  announce.mockRestore();
});

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

it("labels the speed, transcript, and queue buttons with visible text", async () => {
  await render(<PlayerTransport view="player" onView={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Playback speed, 1 times" })).toHaveTextContent("1×Speed");
  expect(screen.getByRole("button", { name: "Transcript and sources" })).toHaveTextContent("Transcript");
  expect(screen.getByRole("button", { name: "Up next" })).toHaveTextContent("Up next");
});

it.each([
  [375, 1, false],
  [375, 1.12, true],
  [393, 1.12, false],
  [402, 1.24, true],
  [430, 1.24, false],
  [440, 1.35, true],
])("on a %i pt screen at %f× text, stacks the actions: %s", (width, fontScale, stacks) => {
  expect(transportStacks(width, fontScale)).toBe(stacks);
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

it("offers no seeking and no time left while the narration's length is still unknown", async () => {
  mockAudio.duration = 0;
  await render(<PlayerTransport view="player" onView={jest.fn()} />);
  const slider = screen.getByRole("adjustable", { name: "Narration position" });
  expect(slider).toHaveProp("disabled", true);
  expect(slider).toHaveProp("value", 0);
  expect(slider).toHaveAccessibilityValue({ text: "0:12" });
  expect(screen.getByRole("button", { name: "Back 15 seconds" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Forward 15 seconds" })).toBeDisabled();
  expect(screen.queryByText(/^−/)).not.toBeOnTheScreen();
  await fireEvent(slider, "accessibilityAction", { nativeEvent: { actionName: "increment" } });
  expect(mockSeek).not.toHaveBeenCalled();
});

it("enables the growing generated range and changes to time remaining when the full duration arrives", async () => {
  mockAudio.duration = 0;
  const { rerender } = await render(<PlayerTransport view="player" onView={jest.fn()} />);
  mockAudio.availableDuration = 24;
  await rerender(<PlayerTransport view="player" onView={jest.fn()} />);
  const slider = screen.getByRole("adjustable", { name: "Narration position" });
  expect(slider).toHaveProp("disabled", false);
  expect(slider).toHaveProp("maximumValue", 24);
  expect(slider).toHaveProp("value", 12);
  expect(slider).toHaveAccessibilityValue({ text: "0:12 of 0:24 available" });
  expect(screen.getByText("0:24 available")).toBeOnTheScreen();
  expect(screen.queryByText(/^−/)).not.toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Back 15 seconds" })).toBeEnabled();
  await fireEvent(slider, "slidingStart", 12);
  await fireEvent(slider, "valueChange", 18);
  mockAudio.availableDuration = 48;
  await rerender(<PlayerTransport view="player" onView={jest.fn()} />);
  expect(slider).toHaveProp("maximumValue", 24);
  expect(slider).toHaveProp("value", 18);
  await fireEvent(slider, "slidingComplete", 18);
  expect(mockSeek).toHaveBeenCalledWith(18);
  expect(slider).toHaveProp("maximumValue", 48);
  mockAudio.duration = 60;
  await rerender(<PlayerTransport view="player" onView={jest.fn()} />);
  expect(slider).toHaveProp("maximumValue", 60);
  expect(screen.getByText("−0:48")).toBeOnTheScreen();
  expect(screen.queryByText(/available/)).not.toBeOnTheScreen();
});
