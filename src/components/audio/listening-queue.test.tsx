import { fireEvent, render, screen } from "@testing-library/react-native";

import { CompactBarMaxTextScale } from "@/constants/theme";
import type { ListeningTrack } from "@/lib/audio/narration";

import { ListeningQueue } from "./listening-queue";

const track = (artworkId: string, title: string, artist: string, date?: string): ListeningTrack => ({
  work: { artworkId: artworkId as never, title, artist, date, facts: [], opening: "" },
});
const nightWatch = track("a", "The Night Watch", "Rembrandt van Rijn");
const venus = track("b", "The Birth of Venus", "Sandro Botticelli");
const lilies = track("c", "Water Lilies", "Claude Monet", "1906");
const starryNight = track("d", "The Starry Night", "Vincent van Gogh", "1889");
const wave = track("e", "The Great Wave off Kanagawa", "Katsushika Hokusai");
const mockController = {
  play: jest.fn(),
  remove: jest.fn(),
  move: jest.fn(),
  clearHistory: jest.fn(),
};
let mockAudio: { current?: ListeningTrack; history: ListeningTrack[]; queue: ListeningTrack[] };
jest.mock("@/lib/audio/use-listening", () => ({
  useListening: () => ({ ...mockAudio, controller: mockController }),
}));
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
const mockDrag = { onDragEnd: undefined as undefined | ((event: { fromIndex: number; toIndex: number }) => void) };
jest.mock("react-native-sortables", () => {
  const React = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: {
      Grid: (props: {
        data: unknown[];
        keyExtractor: (item: unknown) => string;
        renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
        onDragEnd: (event: { fromIndex: number; toIndex: number }) => void;
      }) => {
        mockDrag.onDragEnd = props.onDragEnd;
        return React.createElement(
          View,
          null,
          props.data.map((item, index) =>
            React.createElement(View, { key: props.keyExtractor(item) }, props.renderItem({ item, index })),
          ),
        );
      },
    },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAudio = { current: lilies, history: [nightWatch, venus], queue: [starryNight, wave] };
});

it("lists recently played works above the playing work and what plays next below it", async () => {
  await render(<ListeningQueue onAdd={jest.fn()} />);
  const titles = [
    "The Night Watch",
    "The Birth of Venus",
    "Water Lilies",
    "The Starry Night",
    "The Great Wave off Kanagawa",
  ];
  const shown = screen.getAllByText(/./).map((element) => element.props.children);
  expect(shown.filter((text) => ["History", "Up next", ...titles].includes(text))).toEqual([
    "History",
    ...titles.slice(0, 3),
    "Up next",
    ...titles.slice(3),
  ]);
  expect(screen.getByRole("header", { name: "History" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Up next" })).toBeOnTheScreen();
});

it("plays a work again from history or ahead of its turn from the queue", async () => {
  await render(<ListeningQueue onAdd={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "Play The Night Watch, Rembrandt van Rijn" }));
  expect(mockController.play).toHaveBeenLastCalledWith(nightWatch);
  await fireEvent.press(screen.getByRole("button", { name: "Play The Great Wave off Kanagawa, Katsushika Hokusai" }));
  expect(mockController.play).toHaveBeenLastCalledWith(wave);
});

it("clears history", async () => {
  await render(<ListeningQueue onAdd={jest.fn()} />);
  await fireEvent.press(screen.getByRole("button", { name: "Clear" }));
  expect(mockController.clearHistory).toHaveBeenCalledTimes(1);
});

it("reorders and removes queued works by drag or VoiceOver actions", async () => {
  await render(<ListeningQueue onAdd={jest.fn()} />);
  const first = screen.getByRole("button", { name: "Play The Starry Night, Vincent van Gogh" });
  const last = screen.getByRole("button", { name: "Play The Great Wave off Kanagawa, Katsushika Hokusai" });
  expect(first.props.accessibilityActions.map((action: { label: string }) => action.label)).toEqual([
    "Remove",
    "Move later",
  ]);
  expect(last.props.accessibilityActions.map((action: { label: string }) => action.label)).toEqual([
    "Remove",
    "Move earlier",
  ]);
  await fireEvent(first, "accessibilityAction", { nativeEvent: { actionName: "later" } });
  expect(mockController.move).toHaveBeenLastCalledWith(0, 1);
  await fireEvent(last, "accessibilityAction", { nativeEvent: { actionName: "earlier" } });
  expect(mockController.move).toHaveBeenLastCalledWith(1, 0);
  await fireEvent(last, "accessibilityAction", { nativeEvent: { actionName: "remove" } });
  expect(mockController.remove).toHaveBeenCalledWith("e");
  mockController.move.mockClear();
  mockDrag.onDragEnd?.({ fromIndex: 1, toIndex: 0 });
  expect(mockController.move.mock.calls).toEqual([[1, 0]]);
  expect(mockController.play).not.toHaveBeenCalled();
});

it("shows no history section before anything has finished playing", async () => {
  mockAudio.history = [];
  await render(<ListeningQueue onAdd={jest.fn()} />);
  expect(screen.queryByText("History")).toBeNull();
  expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
});

it("offers saved works from the Up next heading, or as the only row when nothing is queued", async () => {
  const onAdd = jest.fn();
  const { rerender } = await render(<ListeningQueue onAdd={onAdd} />);
  await fireEvent.press(screen.getByRole("button", { name: "Add saved works" }));
  expect(onAdd).toHaveBeenCalledTimes(1);
  mockAudio.queue = [];
  await rerender(<ListeningQueue onAdd={onAdd} />);
  expect(screen.getAllByRole("button", { name: "Add saved works" })).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Add saved works" }));
  expect(onAdd).toHaveBeenCalledTimes(2);
});

it("names each work's artist and date the way the transcript heading does", async () => {
  await render(<ListeningQueue onAdd={jest.fn()} />);
  expect(screen.getByText("Claude Monet · 1906")).toBeOnTheScreen();
  expect(screen.getByText("Vincent van Gogh · 1889")).toBeOnTheScreen();
  expect(screen.getByText("Rembrandt van Rijn")).toBeOnTheScreen();
});

it("keeps the empty queue's add label on one line at accessibility sizes", async () => {
  mockAudio.queue = [];
  await render(<ListeningQueue onAdd={jest.fn()} />);
  expect(screen.getByText("Add saved works").props.maxFontSizeMultiplier).toBe(CompactBarMaxTextScale);
});
