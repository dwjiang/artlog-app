import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useWindowDimensions } from "react-native";

import { Gallery } from "@/constants/theme";

import { ScanResult } from "./welcome-art";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("react-native-worklets", () => jest.requireActual("react-native-worklets/lib/module/mock"));
jest.mock("react-native-reanimated", () => ({
  ...jest.requireMock("react-native-reanimated/mock"),
  cubicBezier: () => "ease-out",
  useReducedMotion: () => false,
}));

type Status = { playing: boolean; currentTime: number; duration: number };
const mockStory = {
  status: { playing: false, currentTime: 0, duration: 18 } as Status,
  listeners: new Set<() => void>(),
  set(next: Partial<Status>) {
    this.status = { ...this.status, ...next };
    for (const listener of this.listeners) listener();
  },
};
const mockPlayer = {
  play: jest.fn(() => mockStory.set({ playing: true })),
  pause: jest.fn(() => mockStory.set({ playing: false })),
  seekTo: jest.fn(async (currentTime: number) => mockStory.set({ currentTime })),
};
const mockConfigure = jest.fn(async () => {});
jest.mock("expo-audio", () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import("react")>("react");
  return {
    setAudioModeAsync: () => mockConfigure(),
    useAudioPlayer: () => mockPlayer,
    useAudioPlayerStatus: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockStory.listeners.add(listener);
          return () => mockStory.listeners.delete(listener);
        },
        () => mockStory.status,
      ),
  };
});

const WORDS = ["Leutze", "painted", "art", "models.", "crossing."];

const expectUnread = (words: string[]) => {
  for (const word of words) expect(screen.getByText(word)).toHaveStyle({ color: Gallery.muted });
};
const expectRead = (words: string[]) => {
  for (const word of words) expect(screen.getByText(word)).toHaveStyle({ color: Gallery.ink });
};
const reach = (currentTime: number) => act(() => mockStory.set({ currentTime }));
const finish = () => act(() => mockStory.set({ playing: false, currentTime: 18 }));

const TALL_SCREEN = { width: 402, height: 874, scale: 3, fontScale: 1 };
const SHORT_SCREEN = { width: 375, height: 667, scale: 2, fontScale: 1 };

beforeEach(() => {
  mockStory.status = { playing: false, currentTime: 0, duration: 18 };
  jest.clearAllMocks();
  jest.mocked(useWindowDimensions).mockReturnValue(TALL_SCREEN);
});

it("keeps the story gray and silent until Play is pressed, then lights each word as the voice reaches it", async () => {
  await render(<ScanResult active />);
  expectUnread(WORDS);
  expect(mockPlayer.play).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole("button", { name: "Play story" }));
  expect(mockConfigure).toHaveBeenCalled();
  expect(mockPlayer.play).toHaveBeenCalled();
  expectUnread(WORDS);

  await reach(1.2);
  expectRead(["Leutze", "painted"]);
  expectUnread(["art", "models."]);

  await finish();
  expectRead(WORDS);
});

it("pauses the voice where it is, and replays from the start once finished", async () => {
  await render(<ScanResult active />);
  await fireEvent.press(screen.getByRole("button", { name: "Play story" }));
  await reach(0.3);
  await fireEvent.press(screen.getByRole("button", { name: "Pause story" }));
  expect(mockPlayer.pause).toHaveBeenCalled();
  expectRead(["Leutze"]);
  expectUnread(["painted"]);

  await fireEvent.press(screen.getByRole("button", { name: "Play story" }));
  expect(mockPlayer.seekTo).not.toHaveBeenCalled();
  await finish();
  await fireEvent.press(screen.getByRole("button", { name: "Replay story" }));
  expect(mockPlayer.seekTo).toHaveBeenCalledWith(0);
  expect(mockPlayer.play).toHaveBeenCalledTimes(3);
  expectUnread(WORDS);
});

it("plays even when the audio session can't be configured", async () => {
  mockConfigure.mockRejectedValueOnce(new Error("session busy"));
  await render(<ScanResult active />);
  await fireEvent.press(screen.getByRole("button", { name: "Play story" }));
  expect(mockPlayer.play).toHaveBeenCalled();
});

it("pauses the voice when the visitor moves on to the next page", async () => {
  const view = await render(<ScanResult active />);
  await fireEvent.press(screen.getByRole("button", { name: "Play story" }));
  await view.rerender(<ScanResult active={false} />);
  expect(mockPlayer.pause).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Play story" })).toBeOnTheScreen();
});

it.each(["configuration", "replay seek"] as const)("cancels pending %s when leaving the page", async (stage) => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const view = await render(<ScanResult active />);
  if (stage === "replay seek") {
    await finish();
    mockPlayer.seekTo.mockImplementationOnce(async (currentTime) => {
      await pending;
      mockStory.set({ currentTime });
    });
  } else {
    mockConfigure.mockReturnValueOnce(pending);
  }
  await fireEvent.press(screen.getByRole("button", { name: stage === "replay seek" ? "Replay story" : "Play story" }));
  await view.rerender(<ScanResult active={false} />);
  await view.rerender(<ScanResult active />);
  await act(async () => resolve());
  expect(mockPlayer.play).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Play story" }));
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

it.each(["configuration", "replay seek"] as const)("cancels pending %s when unmounted", async (stage) => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const view = await render(<ScanResult active />);
  if (stage === "replay seek") {
    await finish();
    mockPlayer.seekTo.mockReturnValueOnce(pending);
  } else {
    mockConfigure.mockReturnValueOnce(pending);
  }
  await fireEvent.press(screen.getByRole("button", { name: stage === "replay seek" ? "Replay story" : "Play story" }));
  await view.unmount();
  await act(async () => resolve());
  expect(mockPlayer.play).not.toHaveBeenCalled();
});

it.each(["pause", "leave the page"] as const)("resumes the final word after %s without restarting", async (action) => {
  const view = await render(<ScanResult active />);
  await fireEvent.press(screen.getByRole("button", { name: "Play story" }));
  await reach(17.3);
  if (action === "pause") {
    await fireEvent.press(screen.getByRole("button", { name: "Pause story" }));
  } else {
    await view.rerender(<ScanResult active={false} />);
    await view.rerender(<ScanResult active />);
  }
  await fireEvent.press(screen.getByRole("button", { name: "Play story" }));
  expect(mockPlayer.seekTo).not.toHaveBeenCalled();
  expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  await finish();
  expect(screen.getByRole("button", { name: "Replay story" })).toBeOnTheScreen();
});

it("shows the story a sentence at a time on short screens, turning when the voice reaches the next", async () => {
  jest.mocked(useWindowDimensions).mockReturnValue(SHORT_SCREEN);
  await render(<ScanResult active />);
  expect(screen.getByLabelText(/^Leutze painted it .* this crossing\.$/)).toBeOnTheScreen();
  expect(screen.getByText("Leutze")).toBeVisible();
  expect(screen.getByText("Whittredge")).not.toBeVisible();

  await fireEvent.press(screen.getByRole("button", { name: "Play story" }));
  await reach(6.5);
  expect(screen.getByText("models.")).toBeVisible();
  expectRead(["models."]);

  await reach(7);
  expect(screen.getByText("models.")).not.toBeVisible();
  expect(screen.getByText("Whittredge")).toBeVisible();

  await finish();
  expect(screen.getByText("crossing.")).toBeVisible();
  expectRead(["crossing."]);
});

it("also shows sentences on a tall screen with a large text size", async () => {
  jest.mocked(useWindowDimensions).mockReturnValue({ ...TALL_SCREEN, fontScale: 1.4 });
  await render(<ScanResult active />);
  expect(screen.getByText("Whittredge")).not.toBeVisible();
});

it("shows the whole story where the screen has room", async () => {
  await render(<ScanResult active />);
  expect(screen.getByText("Leutze")).toBeVisible();
  expect(screen.getByText("crossing.")).toBeVisible();
});
