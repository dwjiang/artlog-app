import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { guideTimeline } from "@/lib/audio/guide-timeline";
import type { NarrationPreparationStage } from "@/lib/audio/narration-preparation";

import type { GuideSentence } from "../../../convex/lib/validators";
import { PlayerTransport } from "./player-transport";

const mockSeek = jest.fn();
const mockToggle = jest.fn();
const mockAudio = {
  position: 12,
  duration: 120,
  availableDuration: 0,
  phase: "ready",
  preparationStage: undefined as NarrationPreparationStage | undefined,
  sentences: undefined as GuideSentence[] | undefined,
  waiting: false,
};
jest.mock("@/lib/audio/use-listening", () => ({
  useListening: () => ({
    ...mockAudio,
    playing: true,
    rate: 1,
    controller: { seek: mockSeek, toggle: mockToggle },
  }),
}));
// Four equally long sentences, one per section, so each section takes a quarter of the guide.
const guide: GuideSentence[] = [
  { sentence: "Ann Lee painted this harbor.", factIds: [], section: "hook" },
  { sentence: "Find the boat near the edge.", factIds: ["f1"], section: "look" },
  { sentence: "She sold it to pay her rent.", factIds: ["f1"], section: "story" },
  { sentence: "Its sea still looks so cold.", factIds: ["f1"], section: "takeaway" },
];
jest.mock("@react-native-community/slider", () => {
  const { View } = jest.requireActual("react-native");
  return function MockSlider(props: object) {
    return <View accessible accessibilityRole="adjustable" {...props} />;
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAudio.position = 12;
  mockAudio.duration = 120;
  mockAudio.availableDuration = 0;
  mockAudio.phase = "ready";
  mockAudio.preparationStage = undefined;
  mockAudio.sentences = undefined;
  mockAudio.waiting = false;
});

it("keeps the controls in place with a busy play button and the stage where the section goes", async () => {
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
  expect(screen.getByText("Generating narration…")).toBeOnTheScreen();
  expect(screen.getByText("—:—")).toBeOnTheScreen();
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

it("names the section being spoken and jumps to the start of another", async () => {
  mockAudio.sentences = guide;
  const { rerender } = await render(<PlayerTransport view="player" onView={jest.fn()} />);
  expect(screen.getByRole("checkbox", { name: "Opening", checked: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("checkbox", { name: "The story" }));
  expect(mockSeek).toHaveBeenCalledWith(60, { clamp: false });
  mockAudio.position = 75;
  await rerender(<PlayerTransport view="player" onView={jest.fn()} />);
  expect(screen.getByRole("checkbox", { name: "The story", checked: true })).toBeOnTheScreen();
});

it("offers no section jumps until the guide can seek", async () => {
  mockAudio.sentences = guide;
  mockAudio.duration = 0;
  await render(<PlayerTransport view="player" onView={jest.fn()} />);
  expect(screen.getByRole("checkbox", { name: "Takeaway" })).toBeDisabled();
});

it("keeps ungenerated sections disabled until their starts are available", async () => {
  mockAudio.sentences = guide;
  mockAudio.duration = 0;
  mockAudio.availableDuration = 4;
  const { rerender } = await render(<PlayerTransport view="player" onView={jest.fn()} />);
  expect(screen.getByRole("checkbox", { name: "Look closer" })).toBeEnabled();
  const story = screen.getByRole("checkbox", { name: "The story" });
  expect(story).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Takeaway" })).toBeDisabled();
  await fireEvent.press(story);
  expect(mockSeek).not.toHaveBeenCalled();
  const start = guideTimeline(guide).starts[2];
  mockAudio.availableDuration = start + 1;
  await rerender(<PlayerTransport view="player" onView={jest.fn()} />);
  expect(story).toBeEnabled();
  await fireEvent.press(story);
  expect(mockSeek).toHaveBeenCalledWith(start, { clamp: false });
  mockAudio.duration = 120;
  await rerender(<PlayerTransport view="player" onView={jest.fn()} />);
  expect(screen.getByRole("checkbox", { name: "Takeaway" })).toBeEnabled();
});

it("says a queued guide is ready only once it is, without hiding its sections", async () => {
  mockAudio.waiting = true;
  mockAudio.phase = "loading";
  const { rerender } = await render(<PlayerTransport view="player" onView={jest.fn()} />);
  expect(screen.queryByText("Ready to play")).toBeNull();
  mockAudio.phase = "ready";
  mockAudio.sentences = guide;
  await rerender(<PlayerTransport view="player" onView={jest.fn()} />);
  expect(screen.getByText("Ready to play")).toBeOnTheScreen();
  expect(screen.getByRole("checkbox", { name: "Opening", checked: true })).toBeOnTheScreen();
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

it("spans a live guide's estimated length while its audio is still generating", async () => {
  mockAudio.sentences = guide;
  mockAudio.duration = 0;
  mockAudio.availableDuration = 4;
  await render(<PlayerTransport view="player" onView={jest.fn()} />);
  const slider = screen.getByRole("adjustable", { name: "Narration position" });
  expect(slider.props.maximumValue).toBeGreaterThan(4);
  expect(slider).toHaveAccessibilityValue({ text: "0:12 of 0:04 available" });
  expect(screen.getByText("0:04 available")).toBeOnTheScreen();
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
