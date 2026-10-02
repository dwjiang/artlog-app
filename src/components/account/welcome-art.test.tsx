import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { Gallery } from "@/constants/theme";

import { ScanResult } from "./welcome-art";

jest.mock("react-native-worklets", () => jest.requireActual("react-native-worklets/lib/module/mock"));
jest.mock("react-native-reanimated", () => ({
  ...jest.requireActual("react-native-reanimated/mock"),
  cubicBezier: () => "ease-out",
  useReducedMotion: () => false,
}));

const WORDS = ["Van", "Gogh", "painted", "Saint-Rémy."];

const expectUnread = (words: string[]) => {
  for (const word of words) expect(screen.getByText(word)).toHaveStyle({ color: Gallery.muted });
};

/** Each word schedules the next once it renders, so time advances a word at a time. */
async function readFor(words: number) {
  for (let word = 0; word < words; word++) await act(() => jest.advanceTimersByTime(300));
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it("keeps the story gray until Play is pressed, then reads it from the first word", async () => {
  await render(<ScanResult />);
  await act(() => jest.advanceTimersByTime(10_000));
  expectUnread(WORDS);

  await fireEvent.press(screen.getByRole("button", { name: "Play story" }));
  await readFor(1);
  expect(screen.getByText("Van")).toHaveStyle({ color: Gallery.ink });
  expectUnread(["Gogh", "Saint-Rémy."]);

  await readFor(20);
  expect(screen.getByText("Saint-Rémy.")).toHaveStyle({ color: Gallery.ink });
});

it("pauses where it is, and replays from gray once finished", async () => {
  await render(<ScanResult />);
  await fireEvent.press(screen.getByRole("button", { name: "Play story" }));
  await readFor(1);
  await fireEvent.press(screen.getByRole("button", { name: "Pause story" }));
  await readFor(20);
  expect(screen.getByText("Van")).toHaveStyle({ color: Gallery.ink });
  expectUnread(["Gogh"]);

  await fireEvent.press(screen.getByRole("button", { name: "Play story" }));
  await readFor(20);
  await fireEvent.press(screen.getByRole("button", { name: "Replay story" }));
  expectUnread(WORDS);
  await readFor(1);
  expect(screen.getByText("Van")).toHaveStyle({ color: Gallery.ink });
});
