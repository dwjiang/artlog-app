import { fireEvent, render, screen } from "@testing-library/react-native";

import { guideTimeline } from "@/lib/audio/guide-timeline";

import type { GuideSentence } from "../../../convex/lib/validators";
import { GuideFollowAlong } from "./guide-follow-along";

const mockSeek = jest.fn(async () => {});
const mockToggle = jest.fn();
// Four equally long sentences over 120 seconds start at 0, 30, 60 and 90.
const guide: GuideSentence[] = [
  { sentence: "Ann Lee painted this harbor.", factIds: [], section: "hook" },
  { sentence: "Find the boat near the edge.", factIds: ["f1"], section: "look" },
  { sentence: "She sold it to pay her rent.", factIds: ["f1"], section: "story" },
  { sentence: "Its sea still looks so cold.", factIds: ["f1"], section: "story" },
];
const mockAudio = {
  current: {
    work: {
      artworkId: "artwork-1",
      title: "Harbor",
      artist: "Ann Lee",
      date: "1901",
      opening: "Ann Lee. Harbor. Dated 1901.",
      facts: [{ id: "f1", sourceUrl: "https://museum.example/harbor", sourceLabel: "Museum" }],
    },
  },
  renderId: "render-1",
  sentences: guide as GuideSentence[] | undefined,
  phase: "ready",
  playing: false,
  position: 65,
  duration: 120,
  availableDuration: 0,
  controller: { seek: mockSeek, toggle: mockToggle },
};
jest.mock("@/lib/audio/use-listening", () => ({ useListening: () => mockAudio }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAudio.phase = "ready";
  mockAudio.position = 65;
  mockAudio.duration = 120;
  mockAudio.availableDuration = 0;
});

it("highlights the sentence being spoken, under the titles of the guide's sections", async () => {
  await render(<GuideFollowAlong />);
  expect(screen.getByText("Ann Lee · 1901")).toBeOnTheScreen();
  expect(screen.getAllByRole("header").map((header) => header.props.children)).toEqual([
    "Opening",
    "Look closer",
    "The story",
  ]);
  expect(screen.getAllByRole("button", { selected: true })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "She sold it to pay her rent.", selected: true })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Its sea still looks so cold. Source: Museum." })).toBeOnTheScreen();
  expect(screen.getByText("Museum")).toBeOnTheScreen();
});

it("plays the guide from a tapped sentence", async () => {
  await render(<GuideFollowAlong />);
  await fireEvent.press(screen.getByRole("button", { name: "Find the boat near the edge." }));
  expect(mockSeek).toHaveBeenCalledWith(30, { play: true, clamp: false });
  expect(mockToggle).not.toHaveBeenCalled();
});

it("enables each sentence only once its start is inside the generated audio", async () => {
  mockAudio.duration = 0;
  mockAudio.availableDuration = 4;
  const { rerender } = await render(<GuideFollowAlong />);
  expect(screen.getByRole("button", { name: "Find the boat near the edge." })).toBeEnabled();
  const story = screen.getByRole("button", { name: "She sold it to pay her rent." });
  expect(story).toBeDisabled();
  await fireEvent.press(story);
  expect(mockSeek).not.toHaveBeenCalled();
  mockAudio.availableDuration = guideTimeline(guide).starts[2];
  await rerender(<GuideFollowAlong />);
  expect(story).toBeDisabled();
  mockAudio.availableDuration += 1;
  await rerender(<GuideFollowAlong />);
  expect(story).toBeEnabled();
  await fireEvent.press(story);
  expect(mockSeek).toHaveBeenCalledWith(guideTimeline(guide).starts[2], { play: true, clamp: false });
});

it("offers the way back to the spoken sentence once the listener scrolls away", async () => {
  await render(<GuideFollowAlong />);
  expect(screen.queryByRole("button", { name: "Back to current line" })).toBeNull();
  await fireEvent(screen.getByTestId("guide-script"), "scrollBeginDrag");
  await fireEvent.press(screen.getByRole("button", { name: "Back to current line" }));
  expect(screen.queryByRole("button", { name: "Back to current line" })).toBeNull();
});

it("keeps the script still until its audio can seek", async () => {
  mockAudio.phase = "loading";
  await render(<GuideFollowAlong />);
  expect(screen.getByRole("button", { name: "Ann Lee painted this harbor." })).toBeDisabled();
});
